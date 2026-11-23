import { PrismaClient, CategorizationRule, Category } from '@prisma/client';

export interface AutoCategorizeResult {
  totalProcessed: number;
  totalCategorized: number;
  updatedCount: number;
  rulesApplied: Record<string, number>;
  matchedTransactions: Array<{
    id: string;
    description: string;
    amount: number;
    categoryName: string;
    matchedBy: 'USER_RULE' | 'BUILTIN_DICTIONARY';
    rulePattern?: string;
  }>;
}

// Remove acentuação e converte para minúsculas
export function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

interface BuiltinRule {
  parentName?: string;
  categoryName: string; // nome da subcategoria ou da categoria pai
  keywords: string[];
}

const BUILTIN_RULES: BuiltinRule[] = [
  // ALIMENTAÇÃO
  {
    parentName: 'Alimentação',
    categoryName: 'Supermercado',
    keywords: [
      'supermercado', 'mercado', 'mercadinho', 'carrefour', 'pao de acucar',
      'extra', 'hortifruti', 'sonda', 'assai', 'atacadao', 'mambo', 'st marche',
      'larissa', 'garrafa', 'pai', 'comercialitagua', 'comercial douglas'
    ],
  },
  {
    parentName: 'Alimentação',
    categoryName: 'Ifood/Viagem',
    keywords: ['ifood', 'ifd*', 'ifd ', 'rappi', 'ubereats', 'aiqfome', 'delivery'],
  },
  {
    parentName: 'Alimentação',
    categoryName: 'Almoço/Padaria',
    keywords: [
      'padaria', 'panificadora', 'lanches', 'pastel', 'confeitaria',
      'casa sao bento', 'pimenta verde', 'casa da vovo'
    ],
  },
  {
    categoryName: 'Bares / Restaurantes',
    keywords: [
      'bistro', 'restaurante', 'pizzaria', 'churrascaria', 'mcdonald',
      'burger', 'burguer', 'subway', 'peixaria', 'peixariadojorge',
      'sagradamassa', 'viena express', 'serafina', 'outback', 'neo geo',
      'lago bistro'
    ],
  },

  // TRANSPORTE
  {
    parentName: 'Transporte',
    categoryName: 'Uber',
    keywords: ['uber', '99app', '99pop', '99*', 'indrive', 'cabify', 'taxi'],
  },
  {
    parentName: 'Transporte',
    categoryName: 'Pedágio',
    keywords: ['nutag', 'pedagio', 'sem parar', 'veloe', 'conectcar', 'auto ban', 'ecovias', 'ccr'],
  },
  {
    parentName: 'Transporte',
    categoryName: 'Combustível',
    keywords: ['posto', 'combustivel', 'ipiranga', 'shell', 'br distrib', 'petrobras', 'graal', 'gasolina'],
  },
  {
    parentName: 'Transporte',
    categoryName: 'Estacionamento',
    keywords: ['estacionamento', 'halos park', 'estapar', 'multipark', 'rotativo', 'zona azul'],
  },
  {
    parentName: 'Transporte',
    categoryName: 'Manutenção',
    keywords: ['original veiculos', 'mecanica', 'autocenter', 'pneus', 'oficina auto'],
  },

  // SAÚDE
  {
    parentName: 'Saúde',
    categoryName: 'Farmácia',
    keywords: ['farmacia', 'droga', 'drogasil', 'droga raia', 'pague menos', 'panvel', 'ultrafarma', 'bifarma'],
  },
  {
    parentName: 'Saúde',
    categoryName: 'Academia',
    keywords: ['smart fit', 'smartfit', 'academia', 'bluefit', 'bioritmo'],
  },

  // ASSINATURAS E SERVIÇOS
  {
    parentName: 'Assinaturas e serviços',
    categoryName: 'Netflix',
    keywords: ['netflix'],
  },
  {
    parentName: 'Assinaturas e serviços',
    categoryName: 'AmazonPrime',
    keywords: ['amazon prime', 'amazonprime', 'amzn prime', 'prime video'],
  },
  {
    parentName: 'Assinaturas e serviços',
    categoryName: 'Youtube',
    keywords: ['youtube', 'google youtub', 'dl*google youtub'],
  },
  {
    parentName: 'Assinaturas e serviços',
    categoryName: 'Apple Music',
    keywords: ['apple.com/bill', 'apple.com', 'itunes'],
  },
  {
    parentName: 'Assinaturas e serviços',
    categoryName: 'Wine',
    keywords: ['wine', 'evino'],
  },
  {
    parentName: 'Assinaturas e serviços',
    categoryName: 'Mubi',
    keywords: ['mubi'],
  },
  {
    parentName: 'Assinaturas e serviços',
    categoryName: 'Globoplay',
    keywords: ['globoplay', 'globo play'],
  },
  {
    parentName: 'Assinaturas e serviços',
    categoryName: 'Disney e Star+',
    keywords: ['disney', 'star+'],
  },

  // APTO 83
  {
    parentName: 'Apto83',
    categoryName: 'Reforma',
    keywords: [
      'leroy merlin', 'farol das tintas', 'telhanorte', 'c&c', 'vidracaria',
      'stsvidracaria', 'poloar', 'poloarstr', 'tintas'
    ],
  },
  {
    parentName: 'Apto83',
    categoryName: 'Movéis/Utensílios',
    keywords: ['magalu', 'magazine lu', 'magazine luiza', 'casas bahia', 'fast shop', 'tok&stok', 'etna'],
  },

  // SEGUROS
  {
    parentName: 'Seguros',
    categoryName: 'Seguro de vida',
    keywords: ['porto seguro', 'tokio marine', 'allianz', 'bradesco seguros', 'sulamerica'],
  },

  // EDUCAÇÃO / CULTURA
  {
    parentName: 'Educação',
    categoryName: 'Loja',
    keywords: ['livraria da vila', 'livraria cultura', 'saraiva'],
  },

  // BR2GO (EMPRESA / TI)
  {
    parentName: 'BR2GO',
    categoryName: 'Contador',
    keywords: ['agilize', 'contador', 'contabilidade'],
  },
  {
    parentName: 'BR2GO',
    categoryName: 'Google One',
    keywords: ['google one', 'google storage'],
  },
];

export async function runAutoCategorization(
  prisma: PrismaClient,
  workspaceId: string,
  options: {
    transactionIds?: string[];
    overwriteExisting?: boolean;
    dryRun?: boolean;
  } = {}
): Promise<AutoCategorizeResult> {
  const { transactionIds, overwriteExisting = false, dryRun = false } = options;

  // 1. Carregar todas as categorias do workspace
  const allCategories = await prisma.category.findMany({
    where: { workspaceId, isArchived: false },
    include: { parent: true },
  });

  // Mapear categorias por chave normalizada (ex: "alimentacao > supermercado" e "supermercado")
  const categoryMap = new Map<string, Category>();
  for (const cat of allCategories) {
    const normName = normalizeText(cat.name);
    if (cat.parent) {
      const normParent = normalizeText(cat.parent.name);
      categoryMap.set(`${normParent} > ${normName}`, cat);
      // Se ainda não existir chave curta ou se preferir filho
      if (!categoryMap.has(normName)) {
        categoryMap.set(normName, cat);
      }
    } else {
      categoryMap.set(normName, cat);
    }
  }

  // 2. Carregar regras cadastradas pelo usuário
  const userRules = await prisma.categorizationRule.findMany({
    where: { workspaceId, isActive: true },
    orderBy: { priority: 'asc' },
    include: { category: true },
  });

  // 3. Buscar transações elegíveis
  const whereClause: any = { workspaceId };
  if (transactionIds && transactionIds.length > 0) {
    whereClause.id = { in: transactionIds };
  }
  if (!overwriteExisting) {
    whereClause.categoryId = null;
  }

  const transactions = await prisma.transaction.findMany({
    where: whereClause,
    select: {
      id: true,
      description: true,
      amount: true,
      categoryId: true,
      accountId: true,
    },
  });

  const matchedTransactions: AutoCategorizeResult['matchedTransactions'] = [];
  const rulesAppliedCount: Record<string, number> = {};
  const userRuleUpdates = new Map<string, { timesApplied: number; lastAppliedAt: Date }>();

  // 4. Processar cada transação
  const updates: Array<{ id: string; categoryId: string; newDescription?: string }> = [];

  for (const tx of transactions) {
    const rawDesc = tx.description || '';
    const normDesc = normalizeText(rawDesc);
    if (!normDesc) continue;

    let matchedCategoryId: string | null = null;
    let matchedCategoryName: string = '';
    let matchType: 'USER_RULE' | 'BUILTIN_DICTIONARY' = 'USER_RULE';
    let matchedRulePattern: string | undefined = undefined;
    let newDescription: string | undefined = undefined;

    // A) Checar regras do usuário primeiro (maior prioridade)
    for (const rule of userRules) {
      if (!rule.categoryId) continue;
      if (rule.accountId && rule.accountId !== tx.accountId) continue;
      if (rule.amountMin && Number(tx.amount) < Number(rule.amountMin)) continue;
      if (rule.amountMax && Number(tx.amount) > Number(rule.amountMax)) continue;

      const rulePattern = rule.caseSensitive ? rule.pattern : normalizeText(rule.pattern);
      const textToMatch = rule.caseSensitive ? rawDesc : normDesc;

      let isMatch = false;
      if (rule.matchType === 'CONTAINS') {
        isMatch = textToMatch.includes(rulePattern);
      } else if (rule.matchType === 'STARTS_WITH') {
        isMatch = textToMatch.startsWith(rulePattern);
      } else if (rule.matchType === 'ENDS_WITH') {
        isMatch = textToMatch.endsWith(rulePattern);
      } else if (rule.matchType === 'EQUALS') {
        isMatch = textToMatch === rulePattern;
      } else if (rule.matchType === 'REGEX') {
        try {
          const reg = new RegExp(rule.pattern, rule.caseSensitive ? undefined : 'i');
          isMatch = reg.test(rawDesc);
        } catch {
          isMatch = false;
        }
      }

      if (isMatch) {
        matchedCategoryId = rule.categoryId;
        matchedCategoryName = rule.category?.name || 'Regra Personalizada';
        matchType = 'USER_RULE';
        matchedRulePattern = rule.pattern;
        if (rule.setDescription) {
          newDescription = rule.setDescription;
        }

        // Estatística da regra do usuário
        const prev = userRuleUpdates.get(rule.id) || { timesApplied: rule.timesApplied || 0, lastAppliedAt: new Date() };
        userRuleUpdates.set(rule.id, { timesApplied: prev.timesApplied + 1, lastAppliedAt: new Date() });
        rulesAppliedCount[`Regra: ${rule.name}`] = (rulesAppliedCount[`Regra: ${rule.name}`] || 0) + 1;
        break;
      }
    }

    // B) Se não casou com regra do usuário, checar catálogo embutido
    if (!matchedCategoryId) {
      for (const builtin of BUILTIN_RULES) {
        const foundKeyword = builtin.keywords.find(kw => normDesc.includes(kw));
        if (foundKeyword) {
          // Achar a categoria correspondente no workspace
          let targetCat: Category | undefined;
          if (builtin.parentName) {
            const fullKey = `${normalizeText(builtin.parentName)} > ${normalizeText(builtin.categoryName)}`;
            targetCat = categoryMap.get(fullKey) || categoryMap.get(normalizeText(builtin.categoryName));
          } else {
            targetCat = categoryMap.get(normalizeText(builtin.categoryName));
          }

          if (targetCat) {
            matchedCategoryId = targetCat.id;
            matchedCategoryName = builtin.parentName ? `${builtin.parentName} > ${targetCat.name}` : targetCat.name;
            matchType = 'BUILTIN_DICTIONARY';
            matchedRulePattern = foundKeyword;
            rulesAppliedCount[matchedCategoryName] = (rulesAppliedCount[matchedCategoryName] || 0) + 1;
            break;
          }
        }
      }
    }

    if (matchedCategoryId) {
      matchedTransactions.push({
        id: tx.id,
        description: rawDesc,
        amount: Number(tx.amount),
        categoryName: matchedCategoryName,
        matchedBy: matchType,
        rulePattern: matchedRulePattern,
      });

      updates.push({
        id: tx.id,
        categoryId: matchedCategoryId,
        newDescription,
      });
    }
  }

  // 5. Aplicar atualizações no banco de dados (se não for dry-run)
  let updatedCount = 0;
  if (!dryRun && updates.length > 0) {
    await prisma.$transaction(async (txPrisma) => {
      for (const update of updates) {
        await txPrisma.transaction.update({
          where: { id: update.id },
          data: {
            categoryId: update.categoryId,
            ...(update.newDescription ? { description: update.newDescription } : {}),
          },
        });
        updatedCount++;
      }

      // Atualizar estatísticas das regras do usuário aplicadas
      for (const [ruleId, stats] of userRuleUpdates.entries()) {
        await txPrisma.categorizationRule.update({
          where: { id: ruleId },
          data: {
            timesApplied: stats.timesApplied,
            lastAppliedAt: stats.lastAppliedAt,
          },
        });
      }
    });
  } else if (dryRun) {
    updatedCount = updates.length;
  }

  return {
    totalProcessed: transactions.length,
    totalCategorized: updates.length,
    updatedCount,
    rulesApplied: rulesAppliedCount,
    matchedTransactions,
  };
}
