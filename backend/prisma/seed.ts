import { PrismaClient, CategoryType, AccountType, InvestmentType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed completo do 10mangos com categorias, contas e cartões reais...');

  // 1. Criar Workspace Pessoal
  const workspace = await prisma.workspace.upsert({
    where: { slug: 'pessoal' },
    update: {},
    create: {
      name: 'Finanças Pessoais',
      slug: 'pessoal',
      currency: 'BRL',
      locale: 'pt-BR',
      timezone: 'America/Sao_Paulo',
      monthStartDay: 1,
    },
  });

  console.log(`✅ Workspace criado: ${workspace.name} (${workspace.id})`);

  // 2. Criar Usuário Administrador
  const hashedPassword = await bcrypt.hash('admin123', 10);
  const user = await prisma.user.upsert({
    where: { email: 'carlos@10mangos.local' },
    update: {
      name: 'Carlos Brazil',
    },
    create: {
      name: 'Carlos Brazil',
      email: 'carlos@10mangos.local',
      passwordHash: hashedPassword,
      defaultWorkspaceId: workspace.id,
    },
  });

  // Vincular Usuário como OWNER do Workspace
  await prisma.workspaceMember.upsert({
    where: {
      workspaceId_userId: {
        workspaceId: workspace.id,
        userId: user.id,
      },
    },
    update: {},
    create: {
      workspaceId: workspace.id,
      userId: user.id,
      role: 'OWNER',
    },
  });

  console.log(`✅ Usuário configurado: ${user.email}`);

  // 3. ESTRUTURA COMPLETA DE CATEGORIAS E SUBCATEGORIAS (pt-BR)
  const categoriesDefinition: Array<{
    name: string;
    type: CategoryType;
    icon?: string;
    color?: string;
    subs: string[];
  }> = [
    // =========================================================================
    //  DESPESAS (EXPENSE)
    // =========================================================================
    {
      name: 'Alimentação',
      type: CategoryType.EXPENSE,
      icon: 'utensils',
      color: '#EC4899',
      subs: ['Almoço/Padaria', 'Diversos/Praia', 'Ifood/Viagem', 'Supermercado'],
    },
    {
      name: 'Apto26',
      type: CategoryType.EXPENSE,
      icon: 'building',
      color: '#06B6D4',
      subs: ['Cartório', 'Condomínio', 'IPTU', 'ITBI', 'Outros 26', 'Quinto Andar'],
    },
    {
      name: 'Apto83',
      type: CategoryType.EXPENSE,
      icon: 'home',
      color: '#F59E0B',
      subs: [
        'Aquisição',
        'Celular',
        'Condomínio',
        'Internet',
        'IPTU',
        'Luz',
        'Movéis/Utensílios',
        'Outros 83',
        'Reforma',
      ],
    },
    {
      name: 'Arken',
      type: CategoryType.EXPENSE,
      icon: 'home',
      color: '#84CC16',
      subs: [
        'Anuais Contrato',
        'Aquisições',
        'Chaves',
        'Comissões',
        'Condomínio',
        'Entrada Contrato',
        'Entrada Financ',
        'Financiamento',
        'Luz',
        'Mensais Contrato',
        'Reforma',
        'Internet',
        'IPTU',
        'Celular',
        'Outros Arken',
      ],
    },
    {
      name: 'Assinaturas e serviços',
      type: CategoryType.EXPENSE,
      icon: 'credit-card',
      color: '#A855F7',
      subs: [
        'Acelerador Pontos',
        'AmazonPrime',
        'Apoia-se',
        'Apple Music',
        'Apple TV',
        'DirectvGo',
        'Disney e Star+',
        'GamePass',
        'Globoplay',
        'ICloud',
        'MeliMais',
        'Mubi',
        'Netflix',
        'Organizze',
        'Paramount+',
        'TikTok',
        'UOL',
        'Wine',
        'Youtube',
      ],
    },
    {
      name: 'Bares / Restaurantes',
      type: CategoryType.EXPENSE,
      icon: 'beer',
      color: '#F97316',
      subs: [],
    },
    {
      name: 'BR2GO',
      type: CategoryType.EXPENSE,
      icon: 'monitor',
      color: '#FB923C',
      subs: [
        'Contador',
        'Cursor',
        'DeepSeek',
        'Google One',
        'Impostos',
        'Openai',
        'Outros TI',
        'Provedor/Hospedagem',
        'UberSuggest',
      ],
    },
    {
      name: 'Celio',
      type: CategoryType.EXPENSE,
      icon: 'user',
      color: '#3B82F6',
      subs: [],
    },
    {
      name: 'Cuidados pessoais',
      type: CategoryType.EXPENSE,
      icon: 'heart',
      color: '#F43F5E',
      subs: ['Cabelereiro/Pedicure'],
    },
    {
      name: 'Digital',
      type: CategoryType.EXPENSE,
      icon: 'dollar-sign',
      color: '#EAB308',
      subs: [],
    },
    {
      name: 'Dívidas e empréstimos',
      type: CategoryType.EXPENSE,
      icon: 'file-text',
      color: '#FB7185',
      subs: ['IPTU Atrasado'],
    },
    {
      name: 'Educação',
      type: CategoryType.EXPENSE,
      icon: 'graduation-cap',
      color: '#6366F1',
      subs: ['Cursos', 'Loja'],
    },
    {
      name: 'Extras',
      type: CategoryType.EXPENSE,
      icon: 'list',
      color: '#14B8A6',
      subs: ['Cemitério', 'Comissões', 'Presentes'],
    },
    {
      name: 'Família e filhos',
      type: CategoryType.EXPENSE,
      icon: 'users',
      color: '#84CC16',
      subs: ['Desp Carlos', 'Desp Celio', 'Desp Cris', 'Desp Rodo'],
    },
    {
      name: 'Impostos e Taxas',
      type: CategoryType.EXPENSE,
      icon: 'percent',
      color: '#F87171',
      subs: ['Anuidades', 'IOF', 'IRPF', 'Taxas Bancárias'],
    },
    {
      name: 'Lazer e hobbies',
      type: CategoryType.EXPENSE,
      icon: 'smile',
      color: '#A3E635',
      subs: ['Beach Tênis', 'Bike', 'Cinema', 'Games', 'Moto', 'Shows', 'Veleiro'],
    },
    {
      name: 'Loterias',
      type: CategoryType.EXPENSE,
      icon: 'ticket',
      color: '#10B981',
      subs: [],
    },
    {
      name: 'Pamela',
      type: CategoryType.EXPENSE,
      icon: 'home',
      color: '#D97706',
      subs: ['Condomínio', 'Internet', 'IPTU', 'Limpeza', 'Luz', 'Manutenção', 'Outros Pam', 'Repasses'],
    },
    {
      name: 'Saúde',
      type: CategoryType.EXPENSE,
      icon: 'activity',
      color: '#38BDF8',
      subs: ['Academia', 'Dentista', 'Farmácia', 'Médico', 'Ótica', 'Suplementos', 'Unimed'],
    },
    {
      name: 'Seguros',
      type: CategoryType.EXPENSE,
      icon: 'shield',
      color: '#818CF8',
      subs: ['Seguro de vida'],
    },
    {
      name: 'Taba',
      type: CategoryType.EXPENSE,
      icon: 'store',
      color: '#0EA5E9',
      subs: ['Condomínio', 'Internet', 'IPTU', 'Limpeza', 'Luz', 'Manutenção', 'Outros Taba'],
    },
    {
      name: 'Transporte',
      type: CategoryType.EXPENSE,
      icon: 'truck',
      color: '#0284C7',
      subs: [
        'Combustível',
        'Estacionamento',
        'IPVA/Licenc/Multas',
        'Manutenção',
        'Outros Carro',
        'Pedágio',
        'Seguro',
        'Top',
        'Uber',
      ],
    },
    {
      name: 'Vestuário',
      type: CategoryType.EXPENSE,
      icon: 'shirt',
      color: '#F97316',
      subs: ['Calçados', 'cama, mesa e banho', 'Roupas'],
    },
    {
      name: 'Viagem',
      type: CategoryType.EXPENSE,
      icon: 'plane',
      color: '#EF4444',
      subs: ['Comidas/Bebidas', 'Hoteis', 'Mercado', 'Parques', 'Presentes', 'Transporte', 'Voos'],
    },

    // =========================================================================
    //  RECEITAS (INCOME)
    // =========================================================================
    {
      name: 'Airbnb e Booking',
      type: CategoryType.INCOME,
      icon: 'calendar',
      color: '#F59E0B',
      subs: ['Pamela Airb', 'Pamela Booking', 'Taba Airb', 'Taba Booking'],
    },
    {
      name: 'BR2GO (Receitas)',
      type: CategoryType.INCOME,
      icon: 'briefcase',
      color: '#F97316',
      subs: ['Faturamento Clientes', 'Consultoria / Projetos'],
    },
    {
      name: 'Empréstimos',
      type: CategoryType.INCOME,
      icon: 'dollar-sign',
      color: '#10B981',
      subs: [],
    },
    {
      name: 'Investimentos',
      type: CategoryType.INCOME,
      icon: 'trending-up',
      color: '#059669',
      subs: ['Caixinha Nu', 'Rendimentos'],
    },
    {
      name: 'Outras receitas',
      type: CategoryType.INCOME,
      icon: 'more-horizontal',
      color: '#14B8A6',
      subs: ['Fornece Club', 'Quinto Andar 26', 'Quinto Andar 83', 'Rodolpho', 'Terceiros'],
    },
    {
      name: 'Salário / Faturamento',
      type: CategoryType.INCOME,
      icon: 'briefcase',
      color: '#0284C7',
      subs: ['Clientes', 'INSS Carlos', 'INSS Cris'],
    },
    {
      name: 'Vendas Imóveis',
      type: CategoryType.INCOME,
      icon: 'building',
      color: '#F97316',
      subs: [],
    },
  ];

  // Inserção das Categorias
  for (const cat of categoriesDefinition) {
    let parent = await prisma.category.findFirst({
      where: {
        workspaceId: workspace.id,
        name: cat.name,
        type: cat.type,
        parentId: null,
      },
    });

    if (!parent) {
      parent = await prisma.category.create({
        data: {
          workspaceId: workspace.id,
          name: cat.name,
          type: cat.type,
          icon: cat.icon,
          color: cat.color,
        },
      });
    }

    for (const subName of cat.subs) {
      const exists = await prisma.category.findFirst({
        where: {
          workspaceId: workspace.id,
          name: subName,
          type: cat.type,
          parentId: parent.id,
        },
      });

      if (!exists) {
        await prisma.category.create({
          data: {
            workspaceId: workspace.id,
            parentId: parent.id,
            name: subName,
            type: cat.type,
          },
        });
      }
    }
  }

  console.log('✅ 30 Categorias e todas as subcategorias criadas!');

  // =========================================================================
  //  4. CONTAS BANCÁRIAS E CARTEIRAS
  // =========================================================================
  const accountsDefinition = [
    {
      name: 'NuWise',
      type: AccountType.DIGITAL_WALLET,
      currency: 'USD', // Conta em Dólar
      color: '#84CC16',
      institutionName: 'Wise',
    },
    {
      name: 'Mercado Pago',
      type: AccountType.DIGITAL_WALLET,
      currency: 'BRL',
      color: '#0284C7',
      institutionName: 'Mercado Pago',
    },
    {
      name: 'C6 Cris',
      type: AccountType.CHECKING,
      currency: 'BRL',
      color: '#1E293B',
      institutionName: 'C6 Bank',
    },
    {
      name: 'Carteira',
      type: AccountType.CASH,
      currency: 'BRL',
      color: '#F59E0B',
      institutionName: 'Dinheiro em Espécie',
    },
    {
      name: 'InterPJ',
      type: AccountType.CHECKING,
      currency: 'BRL',
      color: '#F97316',
      institutionName: 'Banco Inter',
    },
    {
      name: 'Itau PF',
      type: AccountType.CHECKING,
      currency: 'BRL',
      color: '#EA580C',
      institutionName: 'Banco Itaú',
      bankCode: '341',
    },
    {
      name: 'Itaú Invest',
      type: AccountType.INVESTMENT,
      investmentType: InvestmentType.FIXED_INCOME,
      currency: 'BRL',
      color: '#2563EB',
      institutionName: 'Itaú Corretora',
    },
    {
      name: 'Nu Invest',
      type: AccountType.INVESTMENT,
      investmentType: InvestmentType.FIXED_INCOME,
      currency: 'BRL',
      color: '#820AD1',
      institutionName: 'Nu Invest',
    },
    {
      name: 'Nubank',
      type: AccountType.CHECKING,
      currency: 'BRL',
      color: '#820AD1',
      institutionName: 'Nubank',
      bankCode: '260',
    },
  ];

  const createdAccountsMap = new Map<string, string>();

  for (const acc of accountsDefinition) {
    const account = await prisma.account.upsert({
      where: {
        workspaceId_name: {
          workspaceId: workspace.id,
          name: acc.name,
        },
      },
      update: {
        type: acc.type,
        currency: acc.currency,
        color: acc.color,
        institutionName: acc.institutionName,
      },
      create: {
        workspaceId: workspace.id,
        name: acc.name,
        type: acc.type,
        currency: acc.currency,
        color: acc.color,
        institutionName: acc.institutionName,
        bankCode: acc.bankCode,
        initialBalance: 0,
      },
    });

    createdAccountsMap.set(acc.name, account.id);
  }

  console.log(`✅ 9 Contas bancárias e carteiras cadastradas!`);

  // =========================================================================
  //  5. CARTÕES DE CRÉDITO
  // =========================================================================
  const creditCardsDefinition = [
    {
      name: 'Itaú Black',
      closingDay: 14,
      dueDay: 20,
      color: '#1E293B',
      cardBrand: 'Mastercard Black',
      institutionName: 'Banco Itaú',
      paymentAccountName: 'Itau PF',
    },
    {
      name: 'Nu Ultravioleta',
      closingDay: 30,
      dueDay: 6,
      color: '#5B21B6',
      cardBrand: 'Mastercard Black',
      institutionName: 'Nubank',
      paymentAccountName: 'Nubank',
    },
    {
      name: 'Porto Seguro',
      closingDay: 9,
      dueDay: 20,
      color: '#0284C7',
      cardBrand: 'Visa Infinite',
      institutionName: 'Porto Seguro Bank',
      paymentAccountName: 'Itau PF',
    },
  ];

  for (const card of creditCardsDefinition) {
    const paymentAccountId = createdAccountsMap.get(card.paymentAccountName);

    await prisma.account.upsert({
      where: {
        workspaceId_name: {
          workspaceId: workspace.id,
          name: card.name,
        },
      },
      update: {
        closingDay: card.closingDay,
        dueDay: card.dueDay,
        paymentAccountId,
      },
      create: {
        workspaceId: workspace.id,
        name: card.name,
        type: AccountType.CREDIT_CARD,
        currency: 'BRL',
        closingDay: card.closingDay,
        dueDay: card.dueDay,
        cardBrand: card.cardBrand,
        color: card.color,
        institutionName: card.institutionName,
        paymentAccountId,
      },
    });
  }

  console.log(`✅ 3 Cartões de Crédito cadastrados com datas de fechamento e vencimento!`);
  console.log('🎉 Seed do 10mangos concluído com sucesso!');
}

main()
  .catch((e) => {
    console.error('❌ Erro no seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
