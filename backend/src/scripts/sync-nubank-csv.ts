import { prisma } from '../lib/prisma.js';

const csvRaw = `date,title,amount
2026-11-19,NuTag*EOF8G87,"5,70"
2026-11-19,NuTag*EOF8G87,"13,00"
2026-11-19,NuTag*EOF8G87,"6,10"
2026-11-19,NuTag*EOF8G87,"6,10"
2026-11-19,NuTag*EOF8G87,"5,70"
2026-11-18,NuTag*EOF8G87,"3,99"
2026-11-18,Dl*Google Youtub,"26,90"
2026-11-16,NuTag*EOF8G87,"28,00"
2026-11-14,NuTag*EOF8G87,"3,99"
2026-11-13,NuTag*EOF8G87,"3,41"
2026-11-13,Minimercado Larissa e,"15,99"
2026-11-13,Amazonmktplc*Joelargar - Parcela 1/5,"34,80"
2026-11-13,Dl *Uberrides,"10,96"
2026-11-13,Lago Bistro,"68,00"
2026-11-13,Mercadinho Casa Sao Be,"39,78"
2026-11-12,Raia240,"28,28"
2026-11-12,Dl*Uberrides,"16,93"
2026-11-12,Evino - Parcela 1/3,"133,00"
2026-11-11,NuTag*EOF8G87,"3,41"
2026-11-11,Minimercado Larissa e,"35,86"
2026-11-11,Minimercado Larissa e,"13,18"
2026-11-11,Mp *Stsvidracaria,"200,00"
2026-11-11,Casa Sao Bento Lanches,"243,25"
2026-11-09,NuTag*EOF8G87,"3,52"
2026-11-09,NuTag*EOF8G87,"1,80"
2026-11-09,Mercadolivre*Mercadol,"310,80"
2026-11-09,Posto Tres Praias,"200,01"
2026-11-09,Mercadolivre*Mercadoli,"310,80"
2026-11-09,Pimenta Verde Aliment,"10,90"
2026-11-08,NuTag*EOF8G87,"3,52"
2026-11-08,NuTag*EOF8G87,"5,70"
2026-11-08,NuTag*EOF8G87,"13,00"
2026-11-08,NuTag*EOF8G87,"5,70"
2026-11-08,NuTag*EOF8G87,"6,10"
2026-11-08,NuTag*EOF8G87,"6,10"
2026-11-08,Comercialitagua,"19,36"
2026-11-07,Mp *Peixariadojorge,"198,80"
2026-11-06,Pagamento recebido,"- 7.794,31"
2026-11-06,Nubank Ultravioleta,"89,00"
2026-11-06,Supermercado do Pai,"116,55"
2026-11-06,Apple.Com/Bill,"5,90"
2026-11-06,Farol das Tintas,"235,00"
2026-11-05,Mp *Mariaaparecid,"265,44"
2026-11-04,Comercialitagua,"8,95"
2026-11-03,Balio'S Embalagens,"7,50"
2026-11-03,Supermercado do Pai,"728,35"
2026-11-03,Balio'S Embalagens,"5,75"
2026-11-02,Ifd*Restaurante Rei do,"78,42"
2026-11-02,Supermercado do Pai,"54,81"
2026-11-01,NuTag*EOF8G87,"2,92"
2026-11-01,Apple.Com/Bill,"10,50"
2026-11-01,Carrefour 404 Pgr,"103,66"
2026-11-01,Santa Garrafa,"111,42"
2026-11-01,Santa Garrafa,"78,70"
2026-10-31,NuTag*EOF8G87,"5,70"
2026-10-31,NuTag*EOF8G87,"6,10"
2026-10-31,NuTag*EOF8G87,"3,01"
2026-10-31,NuTag*EOF8G87,"5,70"
2026-10-31,NuTag*EOF8G87,"13,00"
2026-10-31,NuTag*EOF8G87,"6,10"
2026-10-31,Ifd*Ifood Club,"49,80"
2026-10-31,Praia do Lago - Parcela 1/6,"290,00"
2026-10-31,Amazonprimebr,"19,90"
2026-10-30,NuTag*EOF8G87,"1,20"
2026-10-30,Leroy Merlin - Parcela 4/5,"393,56"
2026-10-30,Porto Seguro Seguros - Parcela 5/7,"408,68"
2026-10-30,Amazon - Parcela 5/6,"416,50"
2026-10-30,Original Veiculos - Parcela 4/6,"233,33"
2026-10-30,Raia Drogasil - Parcela 2/2,"85,03"
2026-10-30,Comercial Douglas de P - Parcela 2/6,"277,66"
2026-10-30,Mag*Magalu-Magazine Lu - Parcela 3/6,"516,48"
2026-10-30,Mag*Magalu-Magazine Lu - Parcela 3/6,"306,03"`;

async function syncNubank() {
  const workspace = await prisma.workspace.findFirst({ where: { slug: 'pessoal' } });
  if (!workspace) throw new Error('Workspace Pessoal não encontrado');

  const account = await prisma.account.findFirst({
    where: { workspaceId: workspace.id, name: 'Nu Ultravioleta' },
  });
  if (!account) throw new Error('Conta Nu Ultravioleta não encontrada');

  const user = await prisma.user.findFirst({ where: { email: 'carlos@10mangos.local' } });

  // 1. Obter todas as transações atuais de Nu Ultravioleta para preservar categoryId
  const existingTxs = await prisma.transaction.findMany({
    where: { accountId: account.id },
  });

  console.log(`Lançamentos atuais no banco: ${existingTxs.length}`);

  // Mapear categorias existentes por descrição normalizada
  const catByDesc = new Map<string, string>();
  for (const t of existingTxs) {
    if (t.categoryId) {
      catByDesc.set(t.description.toLowerCase().trim(), t.categoryId);
    }
  }

  // 2. Parse das linhas do CSV
  const lines = csvRaw.trim().split('\n').slice(1);
  console.log(`Linhas no CSV oficial da fatura: ${lines.length}`);

  const parsedRows: Array<{
    dateStr: string;
    title: string;
    amount: number;
    isPayment: boolean;
  }> = [];

  for (const line of lines) {
    const parts = line.match(/(?:[^,"]+|"[^"]*")+/g);
    if (!parts || parts.length < 3) continue;

    const dateStr = parts[0].trim();
    const title = parts[1].replace(/^"|"$/g, '').trim();
    const amountRaw = parts[2].replace(/^"|"$/g, '').replace(/\./g, '').replace(',', '.').replace(/\s/g, '');
    const amountVal = parseFloat(amountRaw);

    parsedRows.push({
      dateStr,
      title,
      amount: amountVal,
      isPayment: title.toLowerCase().includes('pagamento') || amountVal < 0,
    });
  }

  // 3. Deletar as 66 transações antigas e imperfeitas do Nu Ultravioleta
  console.log(`Limpando lançamentos antigos do cartão ${account.name}...`);
  await prisma.transaction.deleteMany({
    where: { accountId: account.id },
  });

  // 4. Inserir exatamente as 72 transações oficiais
  let countInserted = 0;
  for (const row of parsedRows) {
    const [y, m, d] = row.dateStr.split('-').map(Number);
    const dateObj = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));

    // Se for compra feita em Outubro (dias 30 e 31), competenceDate deve ser Novembro/2026
    let competenceDate: Date | null = null;
    if (row.dateStr.startsWith('2026-10')) {
      competenceDate = new Date(Date.UTC(2026, 10, 1, 12, 0, 0)); // 2026-11-01
    }

    const matchedCatId = catByDesc.get(row.title.toLowerCase().trim()) || null;

    const isExpense = !row.isPayment;
    const finalAmount = isExpense ? -Math.abs(row.amount) : Math.abs(row.amount);

    await prisma.transaction.create({
      data: {
        workspaceId: workspace.id,
        accountId: account.id,
        type: isExpense ? 'EXPENSE' : 'INCOME',
        status: 'CLEARED',
        source: 'MANUAL',
        amount: finalAmount,
        date: dateObj,
        competenceDate,
        description: row.title,
        categoryId: matchedCatId,
        createdById: user?.id,
      },
    });
    countInserted++;
  }

  console.log(`✅ Inseridas com sucesso ${countInserted} transações no Nu Ultravioleta!`);

  // 5. Validar totais
  const nuTxs = await prisma.transaction.findMany({
    where: { accountId: account.id },
  });
  const despesas = nuTxs.filter(t => Number(t.amount) < 0);
  const totalDespesas = despesas.reduce((acc, t) => acc + Math.abs(Number(t.amount)), 0);
  const octCount = nuTxs.filter(t => t.date.toISOString().startsWith('2026-10')).length;
  const novCount = nuTxs.filter(t => t.date.toISOString().startsWith('2026-11')).length;
  const compCount = nuTxs.filter(t => t.competenceDate !== null).length;

  console.log(`\n--- CONCILIAÇÃO FINAL ---`);
  console.log(`Total Despesas: R$ ${totalDespesas.toFixed(2)} (Esperado: R$ 6983.09)`);
  console.log(`Compras com data real em Outubro/2026: ${octCount} (Esperado: 18)`);
  console.log(`Compras com data real em Novembro/2026: ${novCount} (Esperado: 54)`);
  console.log(`Compras com competência na fatura de Novembro/2026: ${compCount} (Esperado: 18)`);
}

syncNubank()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
