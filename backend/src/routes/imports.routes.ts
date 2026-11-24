import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';
import * as xlsx from 'xlsx';
import { ImportSource, ImportStatus, ImportRowStatus, TransactionSource, TransactionType, TransactionStatus, AccountType, Account, Category } from '@prisma/client';
import { parseOfxString } from '../lib/ofx-parser.js';
import { parseItauCardStatement } from '../lib/itau-card-parser.js';
import { parseNubankCsv } from '../lib/nubank-parser.js';
import { runAutoCategorization, normalizeText, suggestCategoryFromMemory, isFinancialMovementDesc } from '../lib/auto-categorizer.js';
import { prisma } from '../lib/prisma.js';

export interface ParsedImportItem {
  tempId: string;
  rowNumber: number;
  date: string; // YYYY-MM-DD
  competenceDate: string | null; // YYYY-MM-DD
  amount: number;
  type: TransactionType;
  status: TransactionStatus;
  source: TransactionSource;
  description: string;
  originalDescription: string;
  fitId: string | null;
  importHash: string;
  legacyHash: string | null;
  installmentNumber: number | null;
  notes: string | null;
  suggestedCategoryId: string | null;
  suggestedCategoryName: string | null;
}

// Dicionário de sinônimos bancários brasileiros para conciliação semântica entre extrato e previsões manuais
const SEMANTIC_ALIASES: Array<string[]> = [
  ['iptu', 'pmguarulhos', 'tributo', 'prefeitura', 'pmsp', 'imposto predial'],
  ['luz', 'energia', 'edp', 'enel', 'cpfl', 'elektro', 'cemig', 'light', 'celesc'],
  ['celular', 'claro', 'vivo', 'tim', 'telefonia', 'telefone', 'internet', 'banda larga'],
  ['agua', 'sabesp', 'saneamento', 'caesb', 'copasa', 'sanepar'],
  ['gas', 'comgas', 'ultragaz', 'naturgy'],
  ['unimed', 'plano de saude', 'saude', 'convenio', 'amil', 'bradesco saude', 'sulamerica'],
  ['arken', 'condominio', 'financ arken', 'anual arken', 'dda pag tit'],
  ['aluguel', 'locacao', 'imobiliaria', 'quintoandar', 'barra do una'],
  ['salario', 'sispag', 'grpqa', 'pro-labore', 'prolabore', 'remuneracao', 'folha'],
  ['inss', 'pgto inss', 'aposentadoria', 'beneficio'],
  ['porto seguro', 'sisdeb porto', 'seguro', 'tokio marine', 'allianz'],
  ['uol', 'deb autor uol', 'assinatura'],
  ['fatura', 'tit pag tit ulo', 'pagto cartao', 'pgto fatura', 'pagamento de fatura'],
];

const STOPWORDS = new Set([
  'pix', 'transf', 'transferencia', 'pagamento', 'pagto', 'pgto', 'pag', 'tit', 'ulo',
  'deb', 'aut', 'autor', 'automatico', 'sisdeb', 'sispag', 'dda', 'int', 'banco', 'ltda',
  'sa', 's', 'a', 'de', 'da', 'do', 'dos', 'das', 'para', 'com', 'em', 'no', 'na'
]);

function computeDescriptionSimilarity(bankDesc: string, systemDesc: string): { score: number; reason?: string } {
  const normBank = normalizeText(bankDesc);
  const normSys = normalizeText(systemDesc);
  if (!normBank || !normSys) return { score: 0 };

  if (normBank === normSys) {
    return { score: 1, reason: 'Mesma descrição' };
  }
  if (normBank.includes(normSys) || normSys.includes(normBank)) {
    return { score: 0.9, reason: 'Descrição contida no extrato' };
  }

  // Checar grupos semânticos (ex: "PAGAMENTO TRIBUTO PMGUARULHOS" <-> "IPTU Ap26", "DA EDP SP" <-> "Luz Taba")
  for (const group of SEMANTIC_ALIASES) {
    const bankInGroup = group.some((term) => normBank.includes(term));
    const sysInGroup = group.some((term) => normSys.includes(term));
    if (bankInGroup && sysInGroup) {
      return { score: 0.85, reason: 'Correspondência semântica equivalente' };
    }
  }

  // Comparação de tokens relevantes
  const bankTokens = normBank
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  const sysTokens = normSys
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));

  if (bankTokens.length === 0 || sysTokens.length === 0) return { score: 0 };

  let matches = 0;
  for (const st of sysTokens) {
    if (bankTokens.some((bt) => bt === st || bt.includes(st) || st.includes(bt))) {
      matches++;
    }
  }

  if (matches > 0) {
    const ratio = matches / Math.min(bankTokens.length, sysTokens.length);
    return {
      score: Math.min(0.8, 0.4 + ratio * 0.4),
      reason: 'Palavras-chave em comum na descrição',
    };
  }

  return { score: 0 };
}

function parseImportBuffer(
  buffer: Buffer,
  fileName: string,
  account: Account,
  simpleCategoryMap: Map<string, string>,
  richCategoryMap: Map<string, Category & { parent?: Category | null }>,
  userRules: Array<any>
): {
  format: 'OFX' | 'NUBANK_CSV' | 'ITAU_CARD' | 'EXCEL_CSV';
  formatLabel: string;
  ledgerBalance?: number;
  balanceDate?: string;
  periodStart?: string;
  periodEnd?: string;
  items: ParsedImportItem[];
} {
  const lowerName = fileName.toLowerCase();
  const isOfx =
    lowerName.endsWith('.ofx') ||
    buffer.toString('ascii', 0, 100).toUpperCase().includes('OFX') ||
    buffer.toString('ascii', 0, 200).includes('<STMTTRN>');

  const resolveCategory = (rawDesc: string, amount: number, explicitCatName?: string) => {
    if (explicitCatName) {
      const catId = simpleCategoryMap.get(explicitCatName.toLowerCase().trim());
      if (catId) {
        const catObj = Array.from(richCategoryMap.values()).find((c) => c.id === catId);
        return {
          categoryId: catId,
          categoryName: catObj ? (catObj.parent ? `${catObj.parent.name} > ${catObj.name}` : catObj.name) : explicitCatName,
        };
      }
    }
    const memMatch = suggestCategoryFromMemory(rawDesc, amount, account.id, userRules, richCategoryMap);
    if (memMatch) return memMatch;

    const descLower = rawDesc.toLowerCase();
    for (const [name, id] of simpleCategoryMap.entries()) {
      if (name.length > 3 && descLower.includes(name) && !isFinancialMovementDesc(normalizeText(rawDesc))) {
        const catObj = Array.from(richCategoryMap.values()).find((c) => c.id === id);
        return {
          categoryId: id,
          categoryName: catObj ? (catObj.parent ? `${catObj.parent.name} > ${catObj.name}` : catObj.name) : name,
        };
      }
    }
    return null;
  };

  // 1. Formato OFX
  if (isOfx) {
    let ofxText = buffer.toString('utf-8');
    if (ofxText.includes('\uFFFD') || buffer.toString('latin1').includes('CHARSET:1252')) {
      ofxText = buffer.toString('latin1');
    }
    const parsed = parseOfxString(ofxText);
    const items: ParsedImportItem[] = [];
    const occurrences = new Map<string, number>();

    for (let i = 0; i < parsed.transactions.length; i++) {
      const trn = parsed.transactions[i];
      if (isNaN(trn.amount) || !trn.date || isNaN(trn.date.getTime())) {
        continue;
      }
      let amount = trn.amount;
      let type: TransactionType = amount >= 0 ? TransactionType.INCOME : TransactionType.EXPENSE;
      const memoLower = trn.memo.toLowerCase();

      if (account.type === AccountType.CREDIT_CARD) {
        const isPayment =
          memoLower.includes('pagamento') ||
          memoLower.includes('pagto') ||
          trn.type.toUpperCase() === 'CREDIT';
        if (isPayment) {
          type = TransactionType.TRANSFER;
          amount = Math.abs(trn.amount);
        } else {
          type = TransactionType.EXPENSE;
          amount = -Math.abs(trn.amount);
        }
      } else {
        if (
          memoLower.includes('transferência') ||
          memoLower.includes('transferencia') ||
          memoLower.includes('pix transf') ||
          memoLower.includes('transf pix') ||
          memoLower.includes('resgate cdb') ||
          memoLower.includes('aplicacao cdb') ||
          memoLower.includes('tit pag tit ulo')
        ) {
          type = TransactionType.TRANSFER;
        }
      }

      const dateStr = trn.date.toISOString().split('T')[0];
      const baseKey = `${account.id}_${dateStr}_${amount}_${trn.memo}`;
      const occIndex = (occurrences.get(baseKey) || 0) + 1;
      occurrences.set(baseKey, occIndex);

      const legacyHash = crypto
        .createHash('sha256')
        .update(baseKey)
        .digest('hex');

      const importHash =
        occIndex === 1
          ? legacyHash
          : crypto
              .createHash('sha256')
              .update(`${baseKey}_#${occIndex}`)
              .digest('hex');

      let competenceDate: string | null = null;
      if (account.type === AccountType.CREDIT_CARD && type !== TransactionType.TRANSFER) {
        const closingDay = account.closingDay || 30;
        const trnDay = trn.date.getUTCDate();
        if (trnDay >= Math.min(closingDay, 28)) {
          const d = new Date(trn.date);
          d.setUTCMonth(d.getUTCMonth() + 1);
          d.setUTCDate(1);
          competenceDate = d.toISOString().split('T')[0];
        }
      }

      const catSuggestion = type === TransactionType.TRANSFER ? null : resolveCategory(trn.memo, amount);

      items.push({
        tempId: `row-${i + 1}`,
        rowNumber: i + 1,
        date: dateStr,
        competenceDate,
        amount,
        type,
        status: TransactionStatus.CLEARED,
        source: TransactionSource.OFX_IMPORT,
        description: trn.memo,
        originalDescription: trn.memo,
        fitId: trn.fitId || null,
        importHash,
        legacyHash,
        installmentNumber: null,
        notes: null,
        suggestedCategoryId: catSuggestion?.categoryId || null,
        suggestedCategoryName: catSuggestion?.categoryName || null,
      });
    }

    return {
      format: 'OFX',
      formatLabel: 'Extrato Bancário OFX',
      ledgerBalance: parsed.ledgerBalance !== undefined && !isNaN(parsed.ledgerBalance) ? parsed.ledgerBalance : undefined,
      balanceDate: parsed.balanceDate && !isNaN(parsed.balanceDate.getTime()) ? parsed.balanceDate.toISOString().split('T')[0] : undefined,
      periodStart: parsed.periodStart && !isNaN(parsed.periodStart.getTime()) ? parsed.periodStart.toISOString().split('T')[0] : undefined,
      periodEnd: parsed.periodEnd && !isNaN(parsed.periodEnd.getTime()) ? parsed.periodEnd.toISOString().split('T')[0] : undefined,
      items,
    };
  }

  // 2. Formato Fatura Cartão Nubank (.csv)
  try {
    const nubankParsed = parseNubankCsv(buffer);
    if (nubankParsed.isNubank && nubankParsed.transactions.length > 0) {
      const items: ParsedImportItem[] = [];
      const occurrences = new Map<string, number>();

      for (let i = 0; i < nubankParsed.transactions.length; i++) {
        const trn = nubankParsed.transactions[i];
        const occKey = `${trn.rawDate}_${trn.amount}_${trn.description}`;
        const occIndex = (occurrences.get(occKey) || 0) + 1;
        occurrences.set(occKey, occIndex);

        let amount = trn.amount;
        let type: TransactionType = TransactionType.EXPENSE;
        if (trn.isPayment) {
          type = TransactionType.TRANSFER;
          amount = Math.abs(trn.amount);
        } else {
          type = TransactionType.EXPENSE;
          amount = -Math.abs(trn.amount);
        }

        let competenceDate: string | null = null;
        if (account.type === AccountType.CREDIT_CARD && !trn.isPayment) {
          const day = trn.date.getUTCDate();
          if (day >= 28) {
            const d = new Date(Date.UTC(trn.date.getUTCFullYear(), trn.date.getUTCMonth() + 1, 1, 12, 0, 0));
            competenceDate = d.toISOString().split('T')[0];
          }
        }

        const legacyHash = crypto
          .createHash('sha256')
          .update(`${account.id}_${trn.rawDate}_${trn.amount}_${trn.description}_${i}`)
          .digest('hex');

        const occHash = crypto
          .createHash('sha256')
          .update(`${account.id}_${trn.rawDate}_${trn.amount}_${trn.description}_#${occIndex}`)
          .digest('hex');

        const catSuggestion = type === TransactionType.TRANSFER ? null : resolveCategory(trn.description, amount);

        items.push({
          tempId: `row-${i + 1}`,
          rowNumber: i + 1,
          date: trn.date.toISOString().split('T')[0],
          competenceDate,
          amount,
          type,
          status: TransactionStatus.CLEARED,
          source: TransactionSource.EXCEL_IMPORT,
          description: trn.description,
          originalDescription: trn.description,
          fitId: null,
          importHash: occHash,
          legacyHash,
          installmentNumber: trn.installmentNumber || null,
          notes: null,
          suggestedCategoryId: catSuggestion?.categoryId || null,
          suggestedCategoryName: catSuggestion?.categoryName || null,
        });
      }

      return {
        format: 'NUBANK_CSV',
        formatLabel: 'Fatura Cartão Nubank (CSV)',
        items,
      };
    }
  } catch {
    // Segue para outros formatos
  }

  // 3. Formato Fatura Cartão Itaú (.xls, .xlsx, .csv)
  try {
    const itauCardParsed = parseItauCardStatement(buffer);
    if (itauCardParsed.isItauCard && itauCardParsed.transactions.length > 0) {
      let invoiceCompetence: Date | null = null;
      if (itauCardParsed.faturaTitle) {
        const monthsMap: Record<string, number> = {
          janeiro: 1, fevereiro: 2, março: 3, marco: 3, abril: 4, maio: 5, junho: 6,
          julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
        };
        const match = itauCardParsed.faturaTitle
          .toLowerCase()
          .match(/(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\/(\d{4})/i);
        if (match) {
          const mName = match[1];
          const yNum = parseInt(match[2], 10);
          const mNum = monthsMap[mName] || 11;
          invoiceCompetence = new Date(Date.UTC(yNum, mNum - 1, 1, 12, 0, 0));
        }
      }

      const items: ParsedImportItem[] = [];
      const occurrences = new Map<string, number>();

      for (let i = 0; i < itauCardParsed.transactions.length; i++) {
        const trn = itauCardParsed.transactions[i];
        let amount = trn.amount;
        let type: TransactionType = TransactionType.EXPENSE;
        if (trn.isPayment) {
          type = TransactionType.TRANSFER;
          amount = Math.abs(trn.amount);
        } else {
          type = TransactionType.EXPENSE;
          amount = -Math.abs(trn.amount);
        }

        let competenceDate: string | null = null;
        if (invoiceCompetence && !trn.isPayment) {
          const trnYear = trn.date.getUTCFullYear();
          const trnMonth = trn.date.getUTCMonth();
          const invYear = invoiceCompetence.getUTCFullYear();
          const invMonth = invoiceCompetence.getUTCMonth();
          if (trnYear !== invYear || trnMonth !== invMonth) {
            competenceDate = invoiceCompetence.toISOString().split('T')[0];
          }
        }

        const dateStr = trn.rawDate || trn.date.toISOString().split('T')[0];
        const occKey = `${dateStr}_${amount}_${trn.originalDescription}`;
        const occIndex = (occurrences.get(occKey) || 0) + 1;
        occurrences.set(occKey, occIndex);

        const importHash = crypto
          .createHash('sha256')
          .update(`${account.id}_${dateStr}_${amount}_${trn.originalDescription}_${trn.cardNumber || ''}_#${occIndex}`)
          .digest('hex');

        const legacyHash = crypto
          .createHash('sha256')
          .update(`${account.id}_${dateStr}_${amount}_${trn.originalDescription}_${trn.cardNumber || ''}`)
          .digest('hex');

        const catSuggestion = type === TransactionType.TRANSFER ? null : resolveCategory(trn.originalDescription, amount);

        items.push({
          tempId: `row-${i + 1}`,
          rowNumber: i + 1,
          date: trn.date.toISOString().split('T')[0],
          competenceDate,
          amount,
          type,
          status: TransactionStatus.CLEARED,
          source: TransactionSource.EXCEL_IMPORT,
          description: trn.description,
          originalDescription: trn.originalDescription,
          fitId: null,
          importHash,
          legacyHash,
          installmentNumber: trn.installmentNumber || null,
          notes: trn.notes || null,
          suggestedCategoryId: catSuggestion?.categoryId || null,
          suggestedCategoryName: catSuggestion?.categoryName || null,
        });
      }

      return {
        format: 'ITAU_CARD',
        formatLabel: itauCardParsed.faturaTitle ? `Fatura Cartão Itaú (${itauCardParsed.faturaTitle})` : 'Fatura Cartão Itaú',
        items,
      };
    }
  } catch {
    // Segue para Excel/CSV genérico
  }

  // 4. Planilha Universal / Organizze (.xls, .xlsx, .csv)
  let rawRows: any[] = [];
  try {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    rawRows = xlsx.utils.sheet_to_json(worksheet);
  } catch {
    const text = buffer.toString('utf-8');
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length > 0) {
      const headers = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''));
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].match(/(?:[^,"]+|"[^"]*")+/g);
        if (!parts) continue;
        const rowObj: any = {};
        headers.forEach((h, idx) => {
          rowObj[h] = parts[idx] ? parts[idx].trim().replace(/"/g, '') : '';
        });
        rawRows.push(rowObj);
      }
    }
  }

  const items: ParsedImportItem[] = [];
  let rowNum = 1;
  for (const row of rawRows) {
    const rawDate = String(row['Data'] || row['data'] || row['Date'] || '').trim();
    const description = String(row['Descrição'] || row['Descricao'] || row['Description'] || row['Histórico'] || '').trim();
    const rawCategory = String(row['Categoria'] || row['Category'] || '').trim();
    const rawAmount = row['Valor'] || row['valor'] || row['Amount'] || 0;
    const situation = String(row['Situação'] || row['Situacao'] || row['Status'] || '').trim();

    if (!rawDate && !description && !rawAmount) continue;

    let amount: number;
    if (typeof rawAmount === 'number') {
      amount = rawAmount;
    } else {
      const cleaned = String(rawAmount).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
      amount = parseFloat(cleaned);
    }
    if (isNaN(amount)) continue;

    let dateObj: Date;
    if (typeof rawDate === 'number') {
      dateObj = new Date((rawDate - (25567 + 2)) * 86400 * 1000);
    } else if (rawDate.includes('.') || rawDate.includes('/')) {
      const parts = rawDate.split(/[./]/);
      if (parts.length === 3) {
        const [d, m, y] = parts;
        dateObj = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T12:00:00Z`);
      } else {
        dateObj = new Date(rawDate);
      }
    } else {
      dateObj = new Date(rawDate);
    }
    if (isNaN(dateObj.getTime())) {
      dateObj = new Date();
    }

    const isCleared = !situation || (situation.toLowerCase().includes('pago') && !situation.toLowerCase().includes('não pago'));
    const status = isCleared ? TransactionStatus.CLEARED : TransactionStatus.PENDING;

    let type: TransactionType = amount >= 0 ? TransactionType.INCOME : TransactionType.EXPENSE;
    if (
      rawCategory.toLowerCase().includes('transferência') ||
      description.toLowerCase().includes('transferência') ||
      description.toLowerCase().includes('pix transf')
    ) {
      type = TransactionType.TRANSFER;
    }

    const importHash = crypto
      .createHash('sha256')
      .update(`${account.id}_${rawDate}_${amount}_${description}`)
      .digest('hex');

    const catSuggestion = type === TransactionType.TRANSFER ? null : resolveCategory(description, amount, rawCategory);

    items.push({
      tempId: `row-${rowNum}`,
      rowNumber: rowNum++,
      date: dateObj.toISOString().split('T')[0],
      competenceDate: null,
      amount,
      type,
      status,
      source: TransactionSource.EXCEL_IMPORT,
      description: description || 'Sem descrição',
      originalDescription: description || 'Sem descrição',
      fitId: null,
      importHash,
      legacyHash: null,
      installmentNumber: null,
      notes: null,
      suggestedCategoryId: catSuggestion?.categoryId || null,
      suggestedCategoryName: catSuggestion?.categoryName || null,
    });
  }

  return {
    format: 'EXCEL_CSV',
    formatLabel: 'Planilha / Extrato CSV',
    items,
  };
}

export async function importRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // ===========================================================================
  // 1. PREVIEW DE CONCILIAÇÃO BANCÁRIA COM MATCHING INTELIGENTE
  // ===========================================================================
  app.post('/preview', async (request, reply) => {
    const { workspaceId } = request.user;
    const data = await request.file();

    if (!data) {
      return reply.status(400).send({ error: 'Nenhum arquivo enviado' });
    }

    const buffer = await data.toBuffer();
    const fileName = data.filename;
    const accountId =
      ((data.fields.accountId as any)?.value as string) ||
      ((request.query as any)?.accountId as string);

    if (!accountId) {
      return reply.status(400).send({ error: 'Conta de destino não informada' });
    }

    const account = await prisma.account.findFirst({
      where: { id: accountId, workspaceId },
    });

    if (!account) {
      return reply.status(404).send({ error: 'Conta não encontrada' });
    }

    const allCategories = await prisma.category.findMany({
      where: { workspaceId, isArchived: false },
      include: { parent: true },
    });

    const simpleCategoryMap = new Map<string, string>();
    const richCategoryMap = new Map<string, Category & { parent?: Category | null }>();
    for (const cat of allCategories) {
      simpleCategoryMap.set(cat.name.toLowerCase().trim(), cat.id);
      const normName = normalizeText(cat.name);
      if (cat.parent) {
        const normParent = normalizeText(cat.parent.name);
        richCategoryMap.set(`${normParent} > ${normName}`, cat);
        if (!richCategoryMap.has(normName)) {
          richCategoryMap.set(normName, cat);
        }
      } else {
        richCategoryMap.set(normName, cat);
      }
    }

    const userRules = await prisma.categorizationRule.findMany({
      where: { workspaceId, isActive: true },
      orderBy: { priority: 'asc' },
      include: { category: true },
    });

    const parsed = parseImportBuffer(
      buffer,
      fileName,
      account,
      simpleCategoryMap,
      richCategoryMap,
      userRules
    );

    if (parsed.items.length === 0) {
      return reply.status(400).send({
        error: 'Nenhum lançamento válido encontrado no arquivo enviado.',
      });
    }

    // Determinar janela de datas do arquivo para buscar lançamentos existentes da conta
    const timestamps = parsed.items.map((it) => new Date(`${it.date}T12:00:00Z`).getTime());
    const minTs = Math.min(...timestamps);
    const maxTs = Math.max(...timestamps);

    const searchStart = new Date(minTs - 15 * 86400 * 1000);
    const searchEnd = new Date(maxTs + 20 * 86400 * 1000);

    const existingTransactions = await prisma.transaction.findMany({
      where: {
        accountId: account.id,
        workspaceId,
        date: {
          gte: searchStart,
          lte: searchEnd,
        },
      },
      include: {
        category: {
          include: { parent: true },
        },
      },
      orderBy: { date: 'asc' },
    });

    const usedTxIds = new Set<string>();
    const itemMatchMap = new Map<
      string,
      {
        matchStatus: 'DUPLICATE' | 'MATCH' | 'NEW';
        defaultAction: 'IGNORE' | 'RECONCILE' | 'CREATE';
        matchedTransaction: any | null;
        matchScore: number;
        matchMethod: 'FITID' | 'AUTO_EXACT' | 'AUTO_FUZZY' | null;
        matchReason: string | null;
      }
    >();

    // Passo A: Identificar Duplicados Exatos (mesmo fitId ou mesmo importHash/legacyHash)
    for (const item of parsed.items) {
      const dupTx = existingTransactions.find((tx) => {
        if (usedTxIds.has(tx.id)) return false;
        if (item.fitId && tx.fitId && item.fitId === tx.fitId) return true;
        if (tx.importHash && (tx.importHash === item.importHash || (item.legacyHash && tx.importHash === item.legacyHash))) {
          return true;
        }
        return false;
      });

      if (dupTx) {
        usedTxIds.add(dupTx.id);
        itemMatchMap.set(item.tempId, {
          matchStatus: 'DUPLICATE',
          defaultAction: 'IGNORE',
          matchedTransaction: {
            id: dupTx.id,
            date: dupTx.date.toISOString().split('T')[0],
            amount: Number(dupTx.amount),
            description: dupTx.description,
            status: dupTx.status,
            source: dupTx.source,
            categoryId: dupTx.categoryId,
            categoryName: dupTx.category
              ? dupTx.category.parent
                ? `${dupTx.category.parent.name} > ${dupTx.category.name}`
                : dupTx.category.name
              : null,
          },
          matchScore: 100,
          matchMethod: 'FITID',
          matchReason: 'Lançamento já importado anteriormente',
        });
      }
    }

    // Passo B: Calcular Scores de Conciliação (Matching Inteligente) para os itens não duplicados
    interface CandidatePair {
      tempId: string;
      tx: (typeof existingTransactions)[number];
      score: number;
      diffDays: number;
      method: 'AUTO_EXACT' | 'AUTO_FUZZY';
      reason: string;
    }

    const candidatePairs: CandidatePair[] = [];

    for (const item of parsed.items) {
      if (itemMatchMap.has(item.tempId)) continue; // Já é DUPLICATE

      const itemTs = new Date(`${item.date}T12:00:00Z`).getTime();

      for (const tx of existingTransactions) {
        if (usedTxIds.has(tx.id)) continue;

        // Se o lançamento existente já veio de outro OFX (tem fitId diferente), não tentar casar com nova linha OFX
        if (item.fitId && tx.fitId && item.fitId !== tx.fitId) continue;

        // Se não é OFX, só conciliar contra lançamentos PENDING ou lançamentos criados manualmente/recorrentes
        if (
          !item.fitId &&
          tx.status !== TransactionStatus.PENDING &&
          tx.source !== TransactionSource.MANUAL &&
          tx.source !== TransactionSource.RECURRING &&
          tx.source !== TransactionSource.INSTALLMENT
        ) {
          continue;
        }

        const txAmt = Number(tx.amount);
        // Mesmo sinal (ambos despesa ou ambos receita)
        if ((item.amount < 0 && txAmt >= 0) || (item.amount >= 0 && txAmt < 0)) continue;

        const txTs = new Date(`${tx.date.toISOString().split('T')[0]}T12:00:00Z`).getTime();
        const diffDays = Math.round(Math.abs(itemTs - txTs) / (86400 * 1000));
        const diffAmt = Math.abs(item.amount - txAmt);
        const pctDiff = Math.abs(txAmt) > 0 ? diffAmt / Math.abs(txAmt) : 1;
        const descSim = computeDescriptionSimilarity(item.description, tx.description);

        let score = 0;
        let method: 'AUTO_EXACT' | 'AUTO_FUZZY' = 'AUTO_FUZZY';
        let reason = '';

        if (diffAmt < 0.01) {
          // Mesmo valor exato!
          if (diffDays <= 7) {
            score = 92 - diffDays * 1.5;
            if (tx.status === TransactionStatus.PENDING) score += 5;
            if (descSim.score > 0) score += Math.round(descSim.score * 8);
            score = Math.min(99, Math.round(score));
            method = diffDays === 0 ? 'AUTO_EXACT' : 'AUTO_FUZZY';
            reason =
              tx.status === TransactionStatus.PENDING
                ? `Valor exato previsto${diffDays === 0 ? ' na mesma data' : ` (diferença de ${diffDays}d)`}`
                : `Valor exato já lançado na conta${diffDays === 0 ? ' na mesma data' : ` (diferença de ${diffDays}d)`}`;
            if (descSim.reason) {
              reason += ` • ${descSim.reason}`;
            }
          } else if (diffDays <= 20 && (tx.status === TransactionStatus.PENDING || descSim.score >= 0.5)) {
            score = Math.min(90, Math.round(80 - Math.floor(diffDays / 3) + descSim.score * 10));
            method = 'AUTO_FUZZY';
            reason = `Valor exato previsto no mês (diferença de ${diffDays}d)${descSim.reason ? ` • ${descSim.reason}` : ''}`;
          }
        } else if (
          tx.status === TransactionStatus.PENDING &&
          diffDays <= 12 &&
          descSim.score >= 0.5 &&
          pctDiff <= 0.35
        ) {
          // Despesa/receita prevista com valor estimado próximo (ex: conta de luz/água/telefone)
          score = Math.min(88, Math.round(76 + descSim.score * 10 - Math.floor(diffDays / 2)));
          method = 'AUTO_FUZZY';
          reason = `Previsão com valor aproximado (${descSim.reason || 'descrição compatível'})`;
        }

        if (score >= 75) {
          candidatePairs.push({
            tempId: item.tempId,
            tx,
            score,
            diffDays,
            method,
            reason,
          });
        }
      }
    }

    // Ordenar pares candidatos por maior score e menor diferença de dias (atribuição gulosa 1:1)
    candidatePairs.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.diffDays - b.diffDays;
    });

    const matchedTempIds = new Set<string>();
    for (const pair of candidatePairs) {
      if (matchedTempIds.has(pair.tempId) || usedTxIds.has(pair.tx.id)) continue;

      matchedTempIds.add(pair.tempId);
      usedTxIds.add(pair.tx.id);

      itemMatchMap.set(pair.tempId, {
        matchStatus: 'MATCH',
        defaultAction: 'RECONCILE',
        matchedTransaction: {
          id: pair.tx.id,
          date: pair.tx.date.toISOString().split('T')[0],
          amount: Number(pair.tx.amount),
          description: pair.tx.description,
          status: pair.tx.status,
          source: pair.tx.source,
          categoryId: pair.tx.categoryId,
          categoryName: pair.tx.category
            ? pair.tx.category.parent
              ? `${pair.tx.category.parent.name} > ${pair.tx.category.name}`
              : pair.tx.category.name
            : null,
        },
        matchScore: pair.score,
        matchMethod: pair.method,
        matchReason: pair.reason,
      });
    }

    // Montar lista final de itens para revisão
    const previewItems = parsed.items.map((item) => {
      const matchInfo = itemMatchMap.get(item.tempId) || {
        matchStatus: 'NEW' as const,
        defaultAction: 'CREATE' as const,
        matchedTransaction: null,
        matchScore: 0,
        matchMethod: null,
        matchReason: null,
      };

      return {
        ...item,
        ...matchInfo,
      };
    });

    // Lista de lançamentos existentes na conta no período para permitir vínculo manual na interface
    const availableCandidates = existingTransactions
      .map((tx) => ({
        id: tx.id,
        date: tx.date.toISOString().split('T')[0],
        amount: Number(tx.amount),
        description: tx.description,
        status: tx.status,
        source: tx.source,
        fitId: tx.fitId,
        categoryId: tx.categoryId,
        categoryName: tx.category
          ? tx.category.parent
            ? `${tx.category.parent.name} > ${tx.category.name}`
            : tx.category.name
          : null,
      }))
      .sort((a, b) => {
        if (a.status === 'PENDING' && b.status !== 'PENDING') return -1;
        if (a.status !== 'PENDING' && b.status === 'PENDING') return 1;
        return a.date.localeCompare(b.date);
      });

    const summary = {
      total: previewItems.length,
      matched: previewItems.filter((i) => i.matchStatus === 'MATCH').length,
      newItems: previewItems.filter((i) => i.matchStatus === 'NEW').length,
      duplicates: previewItems.filter((i) => i.matchStatus === 'DUPLICATE').length,
    };

    return reply.send({
      account: {
        id: account.id,
        name: account.name,
        type: account.type,
        currency: account.currency,
        currentBalance: Number(account.currentBalance),
        projectedBalance: Number(account.projectedBalance),
      },
      fileName,
      format: parsed.format,
      formatLabel: parsed.formatLabel,
      ledgerBalance: parsed.ledgerBalance ?? null,
      balanceDate: parsed.balanceDate ?? null,
      periodStart: parsed.periodStart || previewItems[0]?.date || null,
      periodEnd: parsed.periodEnd || previewItems[previewItems.length - 1]?.date || null,
      summary,
      items: previewItems,
      availableCandidates,
    });
  });

  // ===========================================================================
  // 2. CONFIRMAR CONCILIAÇÃO BANCÁRIA E IMPORTAÇÃO REVISADA
  // ===========================================================================
  app.post('/confirm-reconciliation', async (request, reply) => {
    const { workspaceId, sub: userId } = request.user;

    const confirmSchema = z.object({
      accountId: z.string().uuid(),
      fileName: z.string().optional(),
      format: z.string().optional(),
      ledgerBalance: z.number().nullable().optional(),
      items: z.array(
        z.object({
          tempId: z.string(),
          action: z.enum(['RECONCILE', 'CREATE', 'IGNORE']),
          matchedTransactionId: z.string().uuid().nullable().optional(),
          keepExistingDescription: z.boolean().optional().default(true),
          date: z.string(),
          competenceDate: z.string().nullable().optional(),
          amount: z.number(),
          type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER', 'ADJUSTMENT']),
          source: z.enum(['OFX_IMPORT', 'EXCEL_IMPORT', 'MANUAL', 'RECURRING', 'INSTALLMENT', 'API']).optional(),
          description: z.string(),
          originalDescription: z.string().optional(),
          fitId: z.string().nullable().optional(),
          importHash: z.string().optional(),
          categoryId: z.string().uuid().nullable().optional(),
          installmentNumber: z.number().nullable().optional(),
          notes: z.string().nullable().optional(),
        })
      ),
    });

    const body = confirmSchema.parse(request.body);

    const account = await prisma.account.findFirst({
      where: { id: body.accountId, workspaceId },
    });

    if (!account) {
      return reply.status(404).send({ error: 'Conta não encontrada' });
    }

    let reconciled = 0;
    let created = 0;
    let ignored = 0;

    // Pré-carregar todos os lançamentos existentes da conta em 1 única query (evita N roundtrips no túnel SSH e previne violação de unique constraints)
    const allAccountTxs = await prisma.transaction.findMany({
      where: {
        accountId: account.id,
        workspaceId,
      },
      select: {
        id: true,
        description: true,
        fitId: true,
        importHash: true,
        categoryId: true,
        status: true,
      },
    });

    const existingTxMap = new Map(allAccountTxs.map((t) => [t.id, t]));
    const fitIdOwnerMap = new Map<string, string>();
    const hashOwnerMap = new Map<string, string>();

    for (const t of allAccountTxs) {
      if (t.fitId) fitIdOwnerMap.set(t.fitId, t.id);
      if (t.importHash) hashOwnerMap.set(t.importHash, t.id);
    }

    const reconciledTxIds = new Set<string>();

    await prisma.$transaction(
      async (tx) => {
        for (const item of body.items) {
          if (item.action === 'IGNORE') {
            ignored++;
            continue;
          }

          if (
            item.action === 'RECONCILE' &&
            item.matchedTransactionId &&
            !reconciledTxIds.has(item.matchedTransactionId)
          ) {
            const existingTx = existingTxMap.get(item.matchedTransactionId);

            if (existingTx) {
              reconciledTxIds.add(existingTx.id);
              const parsedDate = new Date(`${item.date}T12:00:00Z`);
              const finalDescription =
                item.keepExistingDescription !== false ? existingTx.description : item.description;

              // Só atribui fitId ou importHash se não pertencer a OUTRO lançamento da mesma conta
              let safeFitId: string | null = existingTx.fitId;
              if (item.fitId && (!fitIdOwnerMap.has(item.fitId) || fitIdOwnerMap.get(item.fitId) === existingTx.id)) {
                safeFitId = item.fitId;
                fitIdOwnerMap.set(item.fitId, existingTx.id);
              }

              let safeImportHash: string | null = existingTx.importHash;
              if (
                item.importHash &&
                (!hashOwnerMap.has(item.importHash) || hashOwnerMap.get(item.importHash) === existingTx.id)
              ) {
                safeImportHash = item.importHash;
                hashOwnerMap.set(item.importHash, existingTx.id);
              }

              // Se o lançamento estava RECONCILED (travado por trigger), primeiro desbloqueia para CLEARED
              if (existingTx.status === TransactionStatus.RECONCILED) {
                await tx.transaction.update({
                  where: { id: existingTx.id },
                  data: { status: TransactionStatus.CLEARED, reconciliationId: null },
                });
              }

              await tx.transaction.update({
                where: { id: existingTx.id },
                data: {
                  status: TransactionStatus.CLEARED,
                  amount: item.amount,
                  date: parsedDate,
                  clearedDate: parsedDate,
                  description: finalDescription,
                  originalDescription: item.originalDescription || item.description,
                  fitId: safeFitId,
                  importHash: safeImportHash,
                  categoryId: item.categoryId || existingTx.categoryId || null,
                },
              });

              reconciled++;
              continue;
            }
          }

          // Caso action === 'CREATE' (ou fallback se matchedTransactionId não foi encontrado)
          const parsedDate = new Date(`${item.date}T12:00:00Z`);
          const parsedCompetence = item.competenceDate ? new Date(`${item.competenceDate}T12:00:00Z`) : null;

          let safeFitId: string | null = item.fitId || null;
          if (safeFitId && fitIdOwnerMap.has(safeFitId)) {
            safeFitId = null;
          }

          let safeImportHash: string | null = item.importHash || null;
          if (safeImportHash && hashOwnerMap.has(safeImportHash)) {
            safeImportHash = crypto
              .createHash('sha256')
              .update(`${safeImportHash}_${Date.now()}_${Math.random()}`)
              .digest('hex');
          }

          const createdTx = await tx.transaction.create({
            data: {
              workspaceId,
              accountId: account.id,
              type: item.type as TransactionType,
              status: TransactionStatus.CLEARED,
              source: (item.source as TransactionSource) || TransactionSource.OFX_IMPORT,
              amount: item.amount,
              date: parsedDate,
              clearedDate: parsedDate,
              competenceDate: parsedCompetence,
              description: item.description || 'Lançamento importado',
              originalDescription: item.originalDescription || item.description,
              fitId: safeFitId,
              importHash: safeImportHash,
              categoryId: item.categoryId || null,
              installmentNumber: item.installmentNumber || null,
              notes: item.notes || null,
              createdById: userId,
            },
          });

          if (safeFitId) fitIdOwnerMap.set(safeFitId, createdTx.id);
          if (safeImportHash) hashOwnerMap.set(safeImportHash, createdTx.id);

          created++;
        }

        // Garantir recálculo exato do saldo da conta via função nativa do PostgreSQL
        await tx.$executeRawUnsafe(`SELECT fn_recalculate_account_balance('${account.id}'::uuid);`);
      },
      { maxWait: 30000, timeout: 60000 }
    );

    if (created > 0) {
      await runAutoCategorization(prisma, workspaceId).catch(() => {});
    }

    const updatedAccount = await prisma.account.findUnique({
      where: { id: account.id },
    });

    return reply.send({
      message: 'Conciliação bancária concluída com sucesso',
      reconciled,
      created,
      ignored,
      inserted: created + reconciled,
      skipped: ignored,
      account: updatedAccount
        ? {
            id: updatedAccount.id,
            name: updatedAccount.name,
            currentBalance: Number(updatedAccount.currentBalance),
            projectedBalance: Number(updatedAccount.projectedBalance),
          }
        : null,
    });
  });

  // Upload e pré-processamento de arquivo OFX ou Excel
  app.post('/upload', async (request, reply) => {
    const { workspaceId, sub: userId } = request.user;

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'Nenhum arquivo enviado' });
    }

    const buffer = await data.toBuffer();
    const fileName = data.filename;
    const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

    // Identificar a conta destino (se passada no campo adicional do formulário)
    const accountId = (data.fields.accountId as any)?.value as string | undefined;

    const isOfx = fileName.toLowerCase().endsWith('.ofx');
    const isExcel = fileName.toLowerCase().endsWith('.xlsx') || fileName.toLowerCase().endsWith('.xls');

    if (!isOfx && !isExcel) {
      return reply.status(400).send({ error: 'Formato não suportado. Envie um arquivo .ofx ou .xlsx' });
    }

    // Criar o lote de importação (ImportBatch)
    const batch = await prisma.importBatch.create({
      data: {
        workspaceId,
        accountId,
        source: isOfx ? ImportSource.OFX : ImportSource.EXCEL,
        status: ImportStatus.PROCESSING,
        fileName,
        fileHash,
        fileSize: buffer.length,
        createdById: userId,
      },
    });

    try {
      if (isOfx) {
        const ofxText = buffer.toString('latin1'); // Bancos brasileiros costumam usar ISO-8859-1 ou UTF-8
        const parsed = parseOfxString(ofxText);

        // Se a conta não foi informada manualmente, tentar achar pelo ofxAccountId ou ofxBankId
        let resolvedAccountId = accountId;
        if (!resolvedAccountId && parsed.accountId) {
          const matchedAccount = await prisma.account.findFirst({
            where: {
              workspaceId,
              OR: [
                { ofxAccountId: parsed.accountId },
                { accountNumber: { contains: parsed.accountId } },
              ],
            },
          });
          if (matchedAccount) {
            resolvedAccountId = matchedAccount.id;
          }
        }

        // Criar as linhas de staging (ImportRow)
        let rowNumber = 1;
        for (const trn of parsed.transactions) {
          // Gerar hash para prevenir duplicidade de importação
          const trnHash = crypto
            .createHash('sha256')
            .update(`${trn.date.toISOString().split('T')[0]}_${trn.amount}_${trn.memo}`)
            .digest('hex');

          // Checar se já existe um lançamento com esse FITID
          let duplicate = null;
          if (resolvedAccountId) {
            duplicate = await prisma.transaction.findFirst({
              where: {
                accountId: resolvedAccountId,
                OR: [{ fitId: trn.fitId }, { importHash: trnHash }],
              },
            });
          }

          await prisma.importRow.create({
            data: {
              workspaceId,
              batchId: batch.id,
              rowNumber: rowNumber++,
              status: duplicate ? ImportRowStatus.DUPLICATE : ImportRowStatus.READY,
              date: trn.date,
              amount: trn.amount,
              description: trn.memo,
              payeeName: trn.payeeName,
              fitId: trn.fitId,
              checkNumber: trn.checkNumber,
              bankTransactionType: trn.type,
              hash: trnHash,
              rawData: trn as any,
              duplicateOfId: duplicate ? duplicate.id : undefined,
            },
          });
        }

        // Atualizar o lote
        await prisma.importBatch.update({
          where: { id: batch.id },
          data: {
            accountId: resolvedAccountId,
            status: ImportStatus.AWAITING_REVIEW,
            totalRows: parsed.transactions.length,
            ofxBankId: parsed.bankId,
            ofxAccountId: parsed.accountId,
            ofxLedgerBalance: parsed.ledgerBalance,
            ofxBalanceDate: parsed.balanceDate,
            periodStart: parsed.periodStart,
            periodEnd: parsed.periodEnd,
          },
        });
      } else if (isExcel) {
        // Leitura básica de planilha Excel (.xlsx)
        const workbook = xlsx.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows: any[] = xlsx.utils.sheet_to_json(sheet);

        let rowNumber = 1;
        for (const row of rows) {
          // Tentar deduzir colunas padrão: Data, Descricao, Valor
          const rawDate = row['Data'] || row['Date'] || row['data'];
          const rawDesc = row['Descrição'] || row['Descricao'] || row['Description'] || row['Historico'] || 'Lançamento';
          const rawAmount = row['Valor'] || row['Amount'] || row['valor'] || 0;

          const amount = typeof rawAmount === 'number' ? rawAmount : parseFloat(String(rawAmount).replace(/[R$\s.]/g, '').replace(',', '.'));
          const date = rawDate ? new Date(rawDate) : new Date();

          await prisma.importRow.create({
            data: {
              workspaceId,
              batchId: batch.id,
              rowNumber: rowNumber++,
              status: ImportRowStatus.READY,
              date,
              amount,
              description: String(rawDesc),
              rawData: row,
            },
          });
        }

        await prisma.importBatch.update({
          where: { id: batch.id },
          data: {
            status: ImportStatus.AWAITING_REVIEW,
            totalRows: rows.length,
            sheetName,
          },
        });
      }

      // Retornar o lote criado para o frontend
      const createdBatch = await prisma.importBatch.findUnique({
        where: { id: batch.id },
        include: {
          rows: {
            take: 100,
            orderBy: { rowNumber: 'asc' },
          },
          account: true,
        },
      });

      return reply.status(201).send(createdBatch);
    } catch (error: any) {
      await prisma.importBatch.update({
        where: { id: batch.id },
        data: {
          status: ImportStatus.FAILED,
          errors: { message: error.message },
        },
      });
      return reply.status(500).send({ error: 'Erro ao processar arquivo', details: error.message });
    }
  });

  // Obter detalhes de um lote de importação com suas linhas
  app.get('/batches/:id', async (request, reply) => {
    const { workspaceId } = request.user;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    const batch = await prisma.importBatch.findFirst({
      where: { id, workspaceId },
      include: {
        account: true,
        rows: {
          orderBy: { rowNumber: 'asc' },
          include: {
            suggestedCategory: true,
            suggestedPayee: true,
          },
        },
      },
    });

    if (!batch) {
      return reply.status(404).send({ error: 'Lote de importação não encontrado' });
    }

    return batch;
  });

  // Confirmar importação e transformar linhas de staging em lançamentos reais
  app.post('/batches/:id/confirm', async (request, reply) => {
    const { workspaceId, sub: userId } = request.user;
    const { id: batchId } = z.object({ id: z.string().uuid() }).parse(request.params);

    const confirmSchema = z.object({
      accountId: z.string().uuid().optional(), // caso queira sobrescrever a conta
      rowOverrides: z
        .array(
          z.object({
            rowId: z.string().uuid(),
            categoryId: z.string().uuid().optional(),
            ignore: z.boolean().optional(),
          })
        )
        .optional(),
    });

    const body = confirmSchema.parse(request.body);

    const batch = await prisma.importBatch.findFirst({
      where: { id: batchId, workspaceId },
      include: { rows: true },
    });

    if (!batch) {
      return reply.status(404).send({ error: 'Lote de importação não encontrado' });
    }

    const targetAccountId = body.accountId || batch.accountId;
    if (!targetAccountId) {
      return reply.status(400).send({ error: 'Conta de destino não informada' });
    }

    let importedCount = 0;

    await prisma.$transaction(async (tx) => {
      for (const row of batch.rows) {
        // Verificar se usuário pediu para ignorar
        const override = body.rowOverrides?.find((o) => o.rowId === row.id);
        if (override?.ignore || row.status === ImportRowStatus.IGNORED || row.status === ImportRowStatus.DUPLICATE) {
          continue;
        }

        const categoryId = override?.categoryId || row.suggestedCategoryId;
        const amount = Number(row.amount);
        const type = amount >= 0 ? TransactionType.INCOME : TransactionType.EXPENSE;

        const newTx = await tx.transaction.create({
          data: {
            workspaceId,
            accountId: targetAccountId,
            type,
            status: TransactionStatus.CLEARED,
            source: batch.source === ImportSource.OFX ? TransactionSource.OFX_IMPORT : TransactionSource.EXCEL_IMPORT,
            amount,
            date: row.date || new Date(),
            description: row.description || 'Lançamento importado',
            originalDescription: row.description,
            fitId: row.fitId,
            importHash: row.hash,
            categoryId,
            importBatchId: batch.id,
            createdById: userId,
          },
        });

        await tx.importRow.update({
          where: { id: row.id },
          data: {
            status: ImportRowStatus.IMPORTED,
            transactionId: newTx.id,
          },
        });

        importedCount++;
      }

      await tx.importBatch.update({
        where: { id: batch.id },
        data: {
          accountId: targetAccountId,
          status: ImportStatus.COMPLETED,
          importedRows: importedCount,
          completedAt: new Date(),
        },
      });
    });

    return reply.send({
      message: 'Importação concluída com sucesso',
      importedCount,
    });
  });

  // Importação direta de CSV do Organizze
  app.post('/organizze-csv', async (request, reply) => {
    const { workspaceId, sub: userId } = request.user;
    const data = await request.file();

    if (!data) {
      return reply.status(400).send({ error: 'Nenhum arquivo enviado' });
    }

    const buffer = await data.toBuffer();
    const fileName = data.filename.toLowerCase();
    const accountId = (data.fields.accountId as any)?.value as string;

    if (!accountId) {
      return reply.status(400).send({ error: 'Conta de destino não informada' });
    }

    const account = await prisma.account.findFirst({
      where: { id: accountId, workspaceId },
    });

    if (!account) {
      return reply.status(404).send({ error: 'Conta não encontrada' });
    }

    const allCategories = await prisma.category.findMany({
      where: { workspaceId },
    });

    const categoryMap = new Map<string, string>();
    for (const cat of allCategories) {
      categoryMap.set(cat.name.toLowerCase().trim(), cat.id);
    }

    const isOfx =
      fileName.endsWith('.ofx') ||
      buffer.toString('ascii', 0, 100).toUpperCase().includes('OFX') ||
      buffer.toString('ascii', 0, 200).includes('<STMTTRN>');

    // 1. Processar arquivo OFX direto
    if (isOfx) {
      let ofxText = buffer.toString('utf-8');
      if (ofxText.includes('\uFFFD') || buffer.toString('latin1').includes('CHARSET:1252')) {
        ofxText = buffer.toString('latin1');
      }

      const parsed = parseOfxString(ofxText);
      let inserted = 0;
      let skipped = 0;

      for (const trn of parsed.transactions) {
        let amount = trn.amount;
        let type: TransactionType = amount >= 0 ? TransactionType.INCOME : TransactionType.EXPENSE;
        const memoLower = trn.memo.toLowerCase();

        // Se for conta de cartão de crédito (ex: Nubank Cartão / Nu Ultravioleta)
        if (account.type === AccountType.CREDIT_CARD) {
          const isPayment =
            memoLower.includes('pagamento') ||
            memoLower.includes('pagto') ||
            trn.type.toUpperCase() === 'CREDIT';

          if (isPayment) {
            type = TransactionType.TRANSFER;
            amount = Math.abs(trn.amount); // Pagamento de fatura abate a dívida (crédito no cartão)
          } else {
            type = TransactionType.EXPENSE;
            amount = -Math.abs(trn.amount); // Compras entram como débito
          }
        } else {
          if (
            memoLower.includes('transferência') ||
            memoLower.includes('transferencia') ||
            memoLower.includes('pix transf') ||
            memoLower.includes('transf pix') ||
            memoLower.includes('ted ') ||
            memoLower.includes('doc ')
          ) {
            type = TransactionType.TRANSFER;
          }
        }

        // Tentar mapear categoria por nome ou palavra-chave
        let categoryId: string | undefined = undefined;
        for (const [name, id] of categoryMap.entries()) {
          if (name.length > 2 && memoLower.includes(name)) {
            categoryId = id;
            break;
          }
        }

        if (!categoryId) {
          if (/supermerc|mercado|carrefour|extra|pao de acucar|hortifruti|atacad/i.test(trn.memo)) {
            categoryId = categoryMap.get('supermercado') || categoryMap.get('alimentação');
          } else if (/ifood|ubereats|rappi|delivery/i.test(trn.memo)) {
            categoryId = categoryMap.get('ifood/viagem') || categoryMap.get('alimentação');
          } else if (/posto|combustivel|ipiranga|shell|br distrib/i.test(trn.memo)) {
            categoryId = categoryMap.get('combustível') || categoryMap.get('transporte');
          } else if (/farmacia|droga|drogasil|raia|pague menos/i.test(trn.memo)) {
            categoryId = categoryMap.get('farmácia') || categoryMap.get('saúde');
          } else if (/uber|99app|99pop|taxi/i.test(trn.memo)) {
            categoryId = categoryMap.get('aplicativo') || categoryMap.get('transporte');
          } else if (/padaria|restaurante|lanchonete|mcdonald|burger/i.test(trn.memo)) {
            categoryId = categoryMap.get('almoço/padaria') || categoryMap.get('alimentação');
          }
        }

        const importHash = crypto
          .createHash('sha256')
          .update(`${account.id}_${trn.date.toISOString().split('T')[0]}_${amount}_${trn.memo}`)
          .digest('hex');

        const existing = await prisma.transaction.findFirst({
          where: {
            accountId: account.id,
            OR: [
              ...(trn.fitId ? [{ fitId: trn.fitId }] : []),
              { importHash },
            ],
          },
        });

        if (existing) {
          skipped++;
          continue;
        }

        let competenceDate: Date | undefined = undefined;
        if (account.type === AccountType.CREDIT_CARD) {
          const closingDay = account.closingDay || 30;
          const trnDay = trn.date.getUTCDate();
          // Se a compra foi feita nos dias de fechamento (ex: dia 28 a 31),
          // ela cai na fatura do mês seguinte
          if (trnDay >= Math.min(closingDay, 28)) {
            const d = new Date(trn.date);
            d.setUTCMonth(d.getUTCMonth() + 1);
            d.setUTCDate(1);
            d.setUTCHours(12, 0, 0, 0);
            competenceDate = d;
          }
        }

        await prisma.transaction.create({
          data: {
            workspaceId,
            accountId: account.id,
            type,
            status: TransactionStatus.CLEARED,
            source: TransactionSource.OFX_IMPORT,
            amount,
            date: trn.date,
            competenceDate,
            description: trn.memo,
            originalDescription: trn.memo,
            fitId: trn.fitId,
            importHash,
            categoryId,
            createdById: userId,
          },
        });

        inserted++;
      }

      if (inserted > 0) {
        await runAutoCategorization(prisma, workspaceId).catch(() => {});
      }

      return reply.send({
        message: 'Extrato OFX importado com sucesso',
        inserted,
        skipped,
      });
    }

    // 2. Se for Fatura do Cartão Nubank (.csv com colunas date, title, amount)
    try {
      const nubankParsed = parseNubankCsv(buffer);
      if (nubankParsed.isNubank && nubankParsed.transactions.length > 0) {
        let inserted = 0;
        let skipped = 0;

        const occurrences = new Map<string, number>();

        for (let i = 0; i < nubankParsed.transactions.length; i++) {
          const trn = nubankParsed.transactions[i];
          const occKey = `${trn.rawDate}_${trn.amount}_${trn.description}`;
          const occIndex = (occurrences.get(occKey) || 0) + 1;
          occurrences.set(occKey, occIndex);

          let amount = trn.amount;
          let type: TransactionType = TransactionType.EXPENSE;

          if (trn.isPayment) {
            type = TransactionType.TRANSFER;
            amount = Math.abs(trn.amount);
          } else {
            type = TransactionType.EXPENSE;
            amount = -Math.abs(trn.amount);
          }

          const descLower = trn.description.toLowerCase();

          // Categorização inteligente para compras Nubank
          let categoryId: string | undefined = undefined;
          for (const [name, id] of categoryMap.entries()) {
            if (name.length > 2 && descLower.includes(name)) {
              categoryId = id;
              break;
            }
          }

          if (!categoryId) {
            if (/supermerc|mercado|carrefour|extra|pao de acucar|hortifruti|atacad|sonda|sitio verde|minimercado/i.test(trn.description)) {
              categoryId = categoryMap.get('supermercado') || categoryMap.get('alimentação');
            } else if (/ifood|ubereats|rappi|delivery/i.test(trn.description)) {
              categoryId = categoryMap.get('ifood/viagem') || categoryMap.get('alimentação');
            } else if (/uber|99app|99pop|taxi/i.test(trn.description)) {
              categoryId = categoryMap.get('uber') || categoryMap.get('transporte');
            } else if (/apple\.com|netflix|spotify|amazonprime|youtube|mubi|disney|globo/i.test(trn.description)) {
              categoryId = categoryMap.get('assinaturas e serviços') || categoryMap.get('outros');
            } else if (/farmacia|droga|raia|drogasil|pacheco|sao paulo/i.test(trn.description)) {
              categoryId = categoryMap.get('farmácia') || categoryMap.get('saúde');
            } else if (/posto|combustivel|ipiranga|shell|br distrib/i.test(trn.description)) {
              categoryId = categoryMap.get('combustível') || categoryMap.get('transporte');
            } else if (/nutag|pedagio|sem parar|veloe|conectcar/i.test(trn.description)) {
              categoryId = categoryMap.get('pedágio') || categoryMap.get('transporte');
            }
          }

          // Se for cartão de crédito e a compra ocorreu no final do mês anterior (dias 28-31),
          // define a fatura de competência para o mês seguinte
          let competenceDate: Date | null = null;
          if (account.type === AccountType.CREDIT_CARD && !trn.isPayment) {
            const day = trn.date.getUTCDate();
            if (day >= 28) {
              competenceDate = new Date(Date.UTC(trn.date.getUTCFullYear(), trn.date.getUTCMonth() + 1, 1, 12, 0, 0));
            }
          }

          const legacyHash = crypto
            .createHash('sha256')
            .update(`${account.id}_${trn.rawDate}_${trn.amount}_${trn.description}_${i}`)
            .digest('hex');

          const occHash = crypto
            .createHash('sha256')
            .update(`${account.id}_${trn.rawDate}_${trn.amount}_${trn.description}_#${occIndex}`)
            .digest('hex');

          const existing = await prisma.transaction.findFirst({
            where: {
              accountId: account.id,
              OR: [{ importHash: occHash }, { importHash: legacyHash }],
            },
          });

          if (existing) {
            skipped++;
            continue;
          }

          await prisma.transaction.create({
            data: {
              workspaceId,
              accountId: account.id,
              type,
              status: TransactionStatus.CLEARED,
              source: TransactionSource.EXCEL_IMPORT,
              amount,
              date: trn.date,
              competenceDate,
              description: trn.description,
              originalDescription: trn.description,
              importHash: occHash,
              categoryId,
              installmentNumber: trn.installmentNumber,
              createdById: userId,
            },
          });

          inserted++;
        }

        if (inserted > 0) {
          await runAutoCategorization(prisma, workspaceId).catch(() => {});
        }

        return reply.send({
          message: 'Fatura de Cartão Nubank importada com sucesso',
          inserted,
          skipped,
        });
      }
    } catch (nuErr: any) {
      console.error('Erro no parser Nubank:', nuErr);
      // Ignora erro de parse do Nubank e segue para outros formatos
    }

    // 3. Se for Fatura de Cartão Itaú (.xlsx, .xls ou .csv)
    try {
      const itauCardParsed = parseItauCardStatement(buffer);
      if (itauCardParsed.isItauCard && itauCardParsed.transactions.length > 0) {
        let inserted = 0;
        let skipped = 0;

        let invoiceCompetence: Date | null = null;
        if (itauCardParsed.faturaTitle) {
          const monthsMap: Record<string, number> = {
            janeiro: 1, fevereiro: 2, março: 3, marco: 3, abril: 4, maio: 5, junho: 6,
            julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12
          };
          const match = itauCardParsed.faturaTitle.toLowerCase().match(/(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\/(\d{4})/i);
          if (match) {
            const mName = match[1];
            const yNum = parseInt(match[2], 10);
            const mNum = monthsMap[mName] || 11;
            invoiceCompetence = new Date(Date.UTC(yNum, mNum - 1, 1, 12, 0, 0));
          }
        }

        const occurrences = new Map<string, number>();

        for (let i = 0; i < itauCardParsed.transactions.length; i++) {
          const trn = itauCardParsed.transactions[i];
          // Regra de sinal do cartão de crédito:
          // Compra na fatura é um débito/despesa (sinal negativo no 10mangos)
          // Pagamento de fatura/crédito reduz a dívida (sinal positivo no 10mangos)
          let amount = trn.amount;
          let type: TransactionType = TransactionType.EXPENSE;

          if (trn.isPayment) {
            type = TransactionType.TRANSFER;
            amount = Math.abs(trn.amount); // Pagamento de boleto entra como crédito na fatura
          } else {
            type = TransactionType.EXPENSE;
            amount = -Math.abs(trn.amount); // Compras entram como débito
          }

          const descLower = trn.originalDescription.toLowerCase();

          // Categorização inteligente para compras no cartão
          let categoryId: string | undefined = undefined;
          for (const [name, id] of categoryMap.entries()) {
            if (name.length > 2 && descLower.includes(name)) {
              categoryId = id;
              break;
            }
          }

          if (!categoryId) {
            if (/supermerc|mercado|carrefour|extra|pao de acucar|hortifruti|atacad|sonda|sitio verde|minimercado/i.test(trn.originalDescription)) {
              categoryId = categoryMap.get('supermercado') || categoryMap.get('alimentação');
            } else if (/ifood|ubereats|rappi|delivery/i.test(trn.originalDescription)) {
              categoryId = categoryMap.get('ifood/viagem') || categoryMap.get('alimentação');
            } else if (/posto|combustivel|ipiranga|shell|br distrib/i.test(trn.originalDescription)) {
              categoryId = categoryMap.get('combustível') || categoryMap.get('transporte');
            } else if (/farmacia|droga|drogasil|raia|pague menos/i.test(trn.originalDescription)) {
              categoryId = categoryMap.get('farmácia') || categoryMap.get('saúde');
            } else if (/uber|99app|99food|99pop|taxi/i.test(trn.originalDescription)) {
              categoryId = categoryMap.get('uber') || categoryMap.get('transporte');
            } else if (/padaria|restaurante|lanchonete|mcdonald|burger|bistro|pizzaria|lanches/i.test(trn.originalDescription)) {
              categoryId = categoryMap.get('almoço/padaria') || categoryMap.get('alimentação');
            } else if (/netflix|google youtube|amazon prime|globoplay|apple\.com/i.test(trn.originalDescription)) {
              categoryId = categoryMap.get('outros lazer') || categoryMap.get('lazer');
            } else if (/bluefit|wellhub|academia|smartfit/i.test(trn.originalDescription)) {
              categoryId = categoryMap.get('academia') || categoryMap.get('saúde');
            } else if (/leroy merlin/i.test(trn.originalDescription)) {
              categoryId = categoryMap.get('reforma') || categoryMap.get('apto83') || categoryMap.get('apto26');
            } else if (/agilize/i.test(trn.originalDescription)) {
              categoryId = categoryMap.get('contador') || categoryMap.get('br2go');
            } else if (/google one/i.test(trn.originalDescription)) {
              categoryId = categoryMap.get('google one') || categoryMap.get('br2go');
            } else if (/netshoes/i.test(trn.originalDescription)) {
              categoryId = categoryMap.get('roupas') || categoryMap.get('vestuário');
            } else if (/optica/i.test(trn.originalDescription)) {
              categoryId = categoryMap.get('ótica') || categoryMap.get('saúde');
            } else if (/clinica|medico|hospital/i.test(trn.originalDescription)) {
              categoryId = categoryMap.get('médico') || categoryMap.get('saúde');
            }
          }

          // Competência de fatura para compras do ciclo anterior
          let competenceDate: Date | null = null;
          if (invoiceCompetence && !trn.isPayment) {
            const trnYear = trn.date.getUTCFullYear();
            const trnMonth = trn.date.getUTCMonth();
            const invYear = invoiceCompetence.getUTCFullYear();
            const invMonth = invoiceCompetence.getUTCMonth();
            if (trnYear !== invYear || trnMonth !== invMonth) {
              competenceDate = invoiceCompetence;
            }
          }

          const dateStr = trn.rawDate || trn.date.toISOString().split('T')[0];
          const occKey = `${dateStr}_${amount}_${trn.originalDescription}`;
          const occIndex = (occurrences.get(occKey) || 0) + 1;
          occurrences.set(occKey, occIndex);

          const importHash = crypto
            .createHash('sha256')
            .update(`${account.id}_${dateStr}_${amount}_${trn.originalDescription}_${trn.cardNumber || ''}_#${occIndex}`)
            .digest('hex');

          const legacyHash = crypto
            .createHash('sha256')
            .update(`${account.id}_${dateStr}_${amount}_${trn.originalDescription}_${trn.cardNumber || ''}`)
            .digest('hex');

          const existing = await prisma.transaction.findFirst({
            where: {
              accountId: account.id,
              OR: [{ importHash }, { importHash: legacyHash }],
            },
          });

          if (existing) {
            skipped++;
            continue;
          }

          await prisma.transaction.create({
            data: {
              workspaceId,
              accountId: account.id,
              type,
              status: TransactionStatus.CLEARED,
              source: TransactionSource.EXCEL_IMPORT,
              amount,
              date: trn.date,
              competenceDate,
              description: trn.description,
              originalDescription: trn.originalDescription,
              categoryId,
              installmentNumber: trn.installmentNumber,
              notes: trn.notes,
              importHash,
              createdById: userId,
            },
          });

          inserted++;
        }

        if (inserted > 0) {
          await runAutoCategorization(prisma, workspaceId).catch(() => {});
        }

        return reply.send({
          message: 'Fatura de Cartão Itaú importada com sucesso',
          inserted,
          skipped,
        });
      }
    } catch (itauErr) {
      // Se não for fatura Itaú ou der erro no parse, continua para o fluxo normal de Excel/Organizze
    }

    // 3. Leitura universal com SheetJS (suporta .xls real, .xls HTML do Organizze, .xlsx e .csv)
    let rawRows: any[] = [];
    try {
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      rawRows = xlsx.utils.sheet_to_json(worksheet);
    } catch (parseErr) {
      // Fallback para texto puro se for CSV simples
      const text = buffer.toString('utf-8');
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const headers = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''));
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].match(/(?:[^,"]+|"[^"]*")+/g);
        if (!parts) continue;
        const rowObj: any = {};
        headers.forEach((h, idx) => {
          rowObj[h] = parts[idx] ? parts[idx].trim().replace(/"/g, '') : '';
        });
        rawRows.push(rowObj);
      }
    }

    let inserted = 0;
    let skipped = 0;

    for (const row of rawRows) {
      const rawDate = String(row['Data'] || row['data'] || row['Date'] || '').trim();
      const description = String(row['Descrição'] || row['Descricao'] || row['Description'] || row['Histórico'] || '').trim();
      const rawCategory = String(row['Categoria'] || row['Category'] || '').trim();
      const rawAmount = row['Valor'] || row['valor'] || row['Amount'] || 0;
      const situation = String(row['Situação'] || row['Situacao'] || row['Status'] || '').trim();

      if (!rawDate && !description && !rawAmount) continue;

      // Tratar valor numérico ou formatado
      let amount: number;
      if (typeof rawAmount === 'number') {
        amount = rawAmount;
      } else {
        const cleaned = String(rawAmount).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
        amount = parseFloat(cleaned);
      }
      if (isNaN(amount)) continue;

      // Tratar Data (DD.MM.YYYY ou DD/MM/YYYY ou formato Date do Excel)
      let dateObj: Date;
      if (typeof rawDate === 'number') {
        // Data serial do Excel
        dateObj = new Date((rawDate - (25567 + 2)) * 86400 * 1000);
      } else if (rawDate.includes('.') || rawDate.includes('/')) {
        const parts = rawDate.split(/[./]/);
        if (parts.length === 3) {
          const [d, m, y] = parts;
          dateObj = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T12:00:00Z`);
        } else {
          dateObj = new Date(rawDate);
        }
      } else {
        dateObj = new Date(rawDate);
      }

      if (isNaN(dateObj.getTime())) {
        dateObj = new Date();
      }

      const isCleared = situation.toLowerCase().includes('pago') && !situation.toLowerCase().includes('não pago');
      const status = isCleared ? TransactionStatus.CLEARED : TransactionStatus.PENDING;

      let type: TransactionType = amount >= 0 ? TransactionType.INCOME : TransactionType.EXPENSE;
      if (
        rawCategory.toLowerCase().includes('transferência') ||
        description.toLowerCase().includes('transferência') ||
        description.toLowerCase().includes('pix transf')
      ) {
        type = TransactionType.TRANSFER;
      }

      let categoryId = undefined;
      if (rawCategory) {
        categoryId = categoryMap.get(rawCategory.toLowerCase());
        if (!categoryId) {
          for (const [name, id] of categoryMap.entries()) {
            if (name.includes(rawCategory.toLowerCase()) || rawCategory.toLowerCase().includes(name)) {
              categoryId = id;
              break;
            }
          }
        }
      }

      const importHash = crypto
        .createHash('sha256')
        .update(`${account.id}_${rawDate}_${amount}_${description}`)
        .digest('hex');

      const existing = await prisma.transaction.findFirst({
        where: { accountId: account.id, importHash },
      });

      if (existing) {
        skipped++;
        continue;
      }

      await prisma.transaction.create({
        data: {
          workspaceId,
          accountId: account.id,
          type,
          status,
          source: TransactionSource.EXCEL_IMPORT,
          amount,
          date: dateObj,
          description: description || 'Sem descrição',
          originalDescription: description,
          categoryId,
          importHash,
          createdById: userId,
        },
      });

      inserted++;
    }

    if (inserted > 0) {
      await runAutoCategorization(prisma, workspaceId).catch(() => {});
    }

    return reply.send({
      message: 'Planilha do Organizze importada com sucesso',
      inserted,
      skipped,
    });
  });
}
