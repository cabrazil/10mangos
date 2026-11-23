import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CategoryType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

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
}
