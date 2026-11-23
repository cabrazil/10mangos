import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PrismaClient, TransactionType, TransactionStatus, TransactionSource } from '@prisma/client';
import { parseOfxString } from '../lib/ofx-parser.js';

const prisma = new PrismaClient();

async function importOfxCli() {
  const args = process.argv.slice(2);
  let filePath = '';
  let accountName = 'Itau PF';

  for (const arg of args) {
    if (arg.startsWith('--file=')) {
      filePath = arg.replace('--file=', '').replace(/^["']|["']$/g, '');
    } else if (arg.startsWith('--account=')) {
      accountName = arg.replace('--account=', '').replace(/^["']|["']$/g, '');
    }
  }

  if (!filePath) {
    console.log('ℹ️  Uso: npm run import:ofx -- --file="/caminho/do/extrato.ofx" [--account="Itau PF"]');
    // Procurar arquivo .ofx recente no diretório atual ou imports
    const candidateDirs = [process.cwd(), path.join(process.cwd(), 'imports')];
    for (const dir of candidateDirs) {
      if (fs.existsSync(dir)) {
        const found = fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith('.ofx'));
        if (found) {
          filePath = path.join(dir, found);
          console.log(`🔍 Arquivo encontrado automaticamente: ${filePath}`);
          break;
        }
      }
    }
  }

  if (!filePath || !fs.existsSync(filePath)) {
    console.error(`❌ Arquivo não encontrado: ${filePath || 'Nenhum arquivo especificado'}`);
    process.exit(1);
  }

  console.log(`📂 Lendo arquivo OFX: ${filePath}`);
  const buffer = fs.readFileSync(filePath);

  let ofxText = buffer.toString('utf-8');
  if (ofxText.includes('\uFFFD') || buffer.toString('latin1').includes('CHARSET:1252')) {
    ofxText = buffer.toString('latin1');
  }

  const parsed = parseOfxString(ofxText);
  console.log(`📄 Transações encontradas no OFX: ${parsed.transactions.length}`);

  const workspace = await prisma.workspace.findFirst({
    where: { slug: 'pessoal' },
  });
  if (!workspace) throw new Error('Workspace Pessoal não encontrado');

  const user = await prisma.user.findFirst({
    where: { email: 'carlos@10mangos.local' },
  });
  if (!user) throw new Error('Usuário Carlos não encontrado');

  const account = await prisma.account.findFirst({
    where: { workspaceId: workspace.id, name: accountName },
  });
  if (!account) throw new Error(`Conta '${accountName}' não encontrada`);

  const allCategories = await prisma.category.findMany({
    where: { workspaceId: workspace.id },
  });
  const categoryMap = new Map<string, string>();
  for (const cat of allCategories) {
    categoryMap.set(cat.name.toLowerCase().trim(), cat.id);
  }

  let inserted = 0;
  let skipped = 0;

  for (const trn of parsed.transactions) {
    const amount = trn.amount;
    let type: TransactionType = amount >= 0 ? TransactionType.INCOME : TransactionType.EXPENSE;
    const memoLower = trn.memo.toLowerCase();

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

    await prisma.transaction.create({
      data: {
        workspaceId: workspace.id,
        accountId: account.id,
        type,
        status: TransactionStatus.CLEARED,
        source: TransactionSource.OFX_IMPORT,
        amount,
        date: trn.date,
        description: trn.memo,
        originalDescription: trn.memo,
        fitId: trn.fitId,
        importHash,
        categoryId,
        createdById: user.id,
      },
    });

    inserted++;
  }

  console.log(`\n✅ Importação Concluída com Sucesso!`);
  console.log(`🏦 Conta: ${account.name}`);
  console.log(`   • Inseridos: ${inserted}`);
  console.log(`   • Ignorados (já existentes): ${skipped}`);
}

importOfxCli()
  .catch((e) => {
    console.error('❌ Erro na importação:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
