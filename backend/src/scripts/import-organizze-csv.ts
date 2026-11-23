import fs from 'fs';
import path from 'path';
import { PrismaClient, TransactionType, TransactionStatus, TransactionSource } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function importOrganizzeCsv(filePath: string, accountName: string) {
  console.log(`📂 Lendo arquivo: ${filePath}`);
  console.log(`🏦 Conta alvo: ${accountName}`);

  // 1. Obter Workspace e Conta
  const workspace = await prisma.workspace.findFirst({
    where: { slug: 'pessoal' },
  });

  if (!workspace) {
    throw new Error('Workspace Pessoal não encontrado');
  }

  const account = await prisma.account.findFirst({
    where: {
      workspaceId: workspace.id,
      name: accountName,
    },
  });

  if (!account) {
    throw new Error(`Conta '${accountName}' não encontrada no workspace`);
  }

  const user = await prisma.user.findFirst({
    where: { email: 'carlos@10mangos.local' },
  });

  // 2. Mapear todas as categorias e subcategorias existentes
  const allCategories = await prisma.category.findMany({
    where: { workspaceId: workspace.id },
  });

  const categoryMap = new Map<string, string>();
  for (const cat of allCategories) {
    categoryMap.set(cat.name.toLowerCase().trim(), cat.id);
  }

  // 3. Ler o conteúdo do CSV
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const lines = fileContent.split(/\r?\n/).filter((l) => l.trim().length > 0);

  // Pular o cabeçalho
  const dataLines = lines.slice(1);

  let insertedCount = 0;
  let skippedCount = 0;

  for (const line of dataLines) {
    // Parser resiliente de linha CSV respeitando aspas duplas
    const parts = line.match(/(?:[^,"]+|"[^"]*")+/g);
    if (!parts || parts.length < 5) continue;

    const rawDate = parts[0].trim().replace(/"/g, '');
    const description = parts[1].trim().replace(/"/g, '');
    const rawCategory = parts[2].trim().replace(/"/g, '');
    const rawAmount = parts[3].trim().replace(/"/g, '');
    const situation = parts[4].trim().replace(/"/g, '');

    // Formatar Data: DD.MM.YYYY -> YYYY-MM-DD
    const [day, month, year] = rawDate.split('.');
    const dateObj = new Date(`${year}-${month}-${day}T12:00:00Z`);

    const amount = parseFloat(rawAmount);
    if (isNaN(amount)) continue;

    // Situação
    const isCleared = situation.toLowerCase().includes('pago') && !situation.toLowerCase().includes('não pago');
    const status = isCleared ? TransactionStatus.CLEARED : TransactionStatus.PENDING;

    // Tipo de Transação
    let type: TransactionType = amount >= 0 ? TransactionType.INCOME : TransactionType.EXPENSE;
    if (rawCategory.toLowerCase().includes('transferência') || description.toLowerCase().includes('transferência') || description.toLowerCase().includes('pix transf')) {
      type = TransactionType.TRANSFER;
    }

    // Resolver Categoria
    let categoryId = undefined;
    if (rawCategory) {
      categoryId = categoryMap.get(rawCategory.toLowerCase());
      if (!categoryId) {
        // Tentar busca parcial (ex: "Condomínio" em "Condomínio Taba")
        for (const [name, id] of categoryMap.entries()) {
          if (name.includes(rawCategory.toLowerCase()) || rawCategory.toLowerCase().includes(name)) {
            categoryId = id;
            break;
          }
        }
      }
    }

    // Hash único para evitar duplicidades
    const importHash = crypto
      .createHash('sha256')
      .update(`${account.id}_${rawDate}_${amount}_${description}`)
      .digest('hex');

    const existing = await prisma.transaction.findFirst({
      where: {
        accountId: account.id,
        importHash,
      },
    });

    if (existing) {
      skippedCount++;
      continue;
    }

    await prisma.transaction.create({
      data: {
        workspaceId: workspace.id,
        accountId: account.id,
        type,
        status,
        source: TransactionSource.EXCEL_IMPORT,
        amount,
        date: dateObj,
        description,
        originalDescription: description,
        categoryId,
        importHash,
        createdById: user?.id,
      },
    });

    insertedCount++;
  }

  // 4. Buscar saldo atualizado da conta
  const updatedAccount = await prisma.account.findUnique({
    where: { id: account.id },
  });

  console.log(`\n🎉 Importação concluída com sucesso!`);
  console.log(`✅ Lançamentos inseridos: ${insertedCount}`);
  if (skippedCount > 0) {
    console.log(`⚠️ Lançamentos já existentes (ignorados): ${skippedCount}`);
  }
  console.log(`💰 Saldo Atual (Efetivado): R$ ${updatedAccount?.currentBalance}`);
  console.log(`📊 Saldo Projetado (com agendamentos até 30/11): R$ ${updatedAccount?.projectedBalance}`);
}

const possiblePaths = [
  path.resolve(process.cwd(), 'imports/organizze_itau_pf_nov2026.csv'),
  path.resolve(process.cwd(), 'backend/imports/organizze_itau_pf_nov2026.csv'),
  path.resolve(__dirname, '../../imports/organizze_itau_pf_nov2026.csv'),
];
const csvFile = possiblePaths.find((p) => fs.existsSync(p)) || possiblePaths[0];
importOrganizzeCsv(csvFile, 'Itau PF')
  .catch((e) => {
    console.error('❌ Erro na importação:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
