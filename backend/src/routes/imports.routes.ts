import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';
import * as xlsx from 'xlsx';
import { ImportSource, ImportStatus, ImportRowStatus, TransactionSource, TransactionType, TransactionStatus, AccountType } from '@prisma/client';
import { parseOfxString } from '../lib/ofx-parser.js';
import { parseItauCardStatement } from '../lib/itau-card-parser.js';
import { parseNubankCsv } from '../lib/nubank-parser.js';
import { runAutoCategorization } from '../lib/auto-categorizer.js';
import { prisma } from '../lib/prisma.js';

export async function importRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

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
