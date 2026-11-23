import { prisma } from '../lib/prisma.js';

const csvData = `date,title,amount
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

async function main() {
  const account = await prisma.account.findFirst({
    where: { name: 'Nu Ultravioleta' },
  });
  if (!account) throw new Error('Conta Nu Ultravioleta não encontrada');

  const existingTxs = await prisma.transaction.findMany({
    where: { accountId: account.id },
  });

  console.log(`Lançamentos existentes no banco para Nu Ultravioleta: ${existingTxs.length}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
