import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CategoryType, RuleMatchField, RuleMatchType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { runAutoCategorization } from '../lib/auto-categorizer.js';

export async function categoryRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // Listar categorias organizadas em árvore (pais com subcategorias)
  app.get('/', async (request) => {
    const { workspaceId } = request.user;

    const categories = await prisma.category.findMany({
      where: {
        workspaceId,
        parentId: null,
        isArchived: false,
      },
      include: {
        children: {
          where: { isArchived: false },
          orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        },
      },
      orderBy: [{ type: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }],
    });

    return categories;
  });

  // Criar categoria ou subcategoria
  app.post('/', async (request, reply) => {
    const { workspaceId } = request.user;

    const createCategorySchema = z.object({
      name: z.string().min(1, 'Nome é obrigatório'),
      type: z.nativeEnum(CategoryType),
      parentId: z.string().uuid().nullable().optional(),
      icon: z.string().optional(),
      color: z.string().optional(),
    });

    const data = createCategorySchema.parse(request.body);

    // Se for subcategoria, validar se o pai pertence ao workspace e tem o mesmo tipo
    if (data.parentId) {
      const parent = await prisma.category.findFirst({
        where: { id: data.parentId, workspaceId },
      });

      if (!parent) {
        return reply.status(400).send({ error: 'Categoria pai não encontrada' });
      }

      if (parent.type !== data.type) {
        return reply.status(400).send({ error: 'O tipo da subcategoria deve ser igual ao da categoria pai' });
      }
    }

    const category = await prisma.category.create({
      data: {
        workspaceId,
        name: data.name,
        type: data.type,
        parentId: data.parentId,
        icon: data.icon,
        color: data.color,
      },
    });

    return reply.status(201).send(category);
  });

  // Atualizar categoria
  app.put('/:id', async (request, reply) => {
    const { workspaceId } = request.user;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    const updateCategorySchema = z.object({
      name: z.string().min(1).optional(),
      icon: z.string().optional(),
      color: z.string().optional(),
      isArchived: z.boolean().optional(),
    });

    const data = updateCategorySchema.parse(request.body);

    const result = await prisma.category.updateMany({
      where: { id, workspaceId },
      data,
    });

    if (result.count === 0) {
      return reply.status(404).send({ error: 'Categoria não encontrada' });
    }

    const updated = await prisma.category.findUnique({ where: { id } });
    return updated;
  });

  // Executar auto-categorização inteligente em lote
  app.post('/auto-categorize', async (request, reply) => {
    const { workspaceId } = request.user;

    const schema = z.object({
      transactionIds: z.array(z.string().uuid()).optional(),
      overwriteExisting: z.boolean().optional().default(false),
      dryRun: z.boolean().optional().default(false),
    });

    const options = schema.parse(request.body || {});

    const result = await runAutoCategorization(prisma, workspaceId, options);
    return reply.send(result);
  });

  // Listar regras de categorização
  app.get('/rules', async (request) => {
    const { workspaceId } = request.user;

    const rules = await prisma.categorizationRule.findMany({
      where: { workspaceId },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            parent: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
    });

    return rules;
  });

  // Criar regra de categorização
  app.post('/rules', async (request, reply) => {
    const { workspaceId } = request.user;

    const createRuleSchema = z.object({
      name: z.string().min(1, 'Nome da regra é obrigatório'),
      pattern: z.string().min(1, 'Padrão de busca é obrigatório'),
      matchField: z.nativeEnum(RuleMatchField).default(RuleMatchField.DESCRIPTION),
      matchType: z.nativeEnum(RuleMatchType).default(RuleMatchType.CONTAINS),
      caseSensitive: z.boolean().default(false),
      priority: z.number().int().default(100),
      categoryId: z.string().uuid('Categoria inválida'),
      setDescription: z.string().optional(),
    });

    const data = createRuleSchema.parse(request.body);

    // Valida categoria no workspace
    const cat = await prisma.category.findFirst({
      where: { id: data.categoryId, workspaceId },
    });

    if (!cat) {
      return reply.status(400).send({ error: 'Categoria não encontrada no workspace' });
    }

    const rule = await prisma.categorizationRule.create({
      data: {
        workspaceId,
        name: data.name,
        pattern: data.pattern,
        matchField: data.matchField,
        matchType: data.matchType,
        caseSensitive: data.caseSensitive,
        priority: data.priority,
        categoryId: data.categoryId,
        setDescription: data.setDescription,
      },
      include: {
        category: true,
      },
    });

    return reply.status(201).send(rule);
  });

  // Excluir regra
  app.delete('/rules/:id', async (request, reply) => {
    const { workspaceId } = request.user;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    const deleted = await prisma.categorizationRule.deleteMany({
      where: { id, workspaceId },
    });

    if (deleted.count === 0) {
      return reply.status(404).send({ error: 'Regra não encontrada' });
    }

    return reply.status(204).send();
  });
}
