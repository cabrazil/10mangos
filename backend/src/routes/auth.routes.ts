import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';

export async function authRoutes(app: FastifyInstance) {
  // Registro de novo usuário com workspace pessoal automático
  app.post('/register', async (request, reply) => {
    const registerSchema = z.object({
      name: z.string().min(2, 'Nome deve ter no mínimo 2 caracteres'),
      email: z.string().email('E-mail inválido'),
      password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
      workspaceName: z.string().optional(),
    });

    const data = registerSchema.parse(request.body);

    const existingUser = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      return reply.status(400).send({ error: 'E-mail já cadastrado' });
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    const workspaceSlug = `${data.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Math.random().toString(36).substring(2, 6)}`;

    const result = await prisma.$transaction(async (tx) => {
      // 1. Criar Workspace inicial
      const workspace = await tx.workspace.create({
        data: {
          name: data.workspaceName || `Finanças de ${data.name.split(' ')[0]}`,
          slug: workspaceSlug,
          currency: 'BRL',
          locale: 'pt-BR',
        },
      });

      // 2. Criar Usuário
      const user = await tx.user.create({
        data: {
          name: data.name,
          email: data.email,
          passwordHash,
          defaultWorkspaceId: workspace.id,
        },
      });

      // 3. Associar como OWNER
      await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          role: 'OWNER',
        },
      });

      return { user, workspace };
    });

    const token = app.jwt.sign(
      {
        sub: result.user.id,
        email: result.user.email,
        workspaceId: result.workspace.id,
      },
      { expiresIn: '7d' }
    );

    return reply.status(201).send({
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
      },
      workspace: {
        id: result.workspace.id,
        name: result.workspace.name,
        slug: result.workspace.slug,
      },
      token,
    });
  });

  // Login
  app.post('/login', async (request, reply) => {
    const loginSchema = z.object({
      email: z.string().email(),
      password: z.string(),
    });

    const { email, password } = loginSchema.parse(request.body);

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          include: {
            workspace: true,
          },
        },
      },
    });

    if (!user || !user.passwordHash) {
      return reply.status(401).send({ error: 'Credenciais inválidas' });
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      return reply.status(401).send({ error: 'Credenciais inválidas' });
    }

    // Identificar o workspace padrão ou o primeiro
    const defaultMembership = user.memberships.find((m) => m.workspaceId === user.defaultWorkspaceId) || user.memberships[0];

    if (!defaultMembership) {
      return reply.status(403).send({ error: 'Usuário sem workspace associado' });
    }

    const token = app.jwt.sign(
      {
        sub: user.id,
        email: user.email,
        workspaceId: defaultMembership.workspaceId,
      },
      { expiresIn: '7d' }
    );

    return reply.send({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      workspaces: user.memberships.map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        slug: m.workspace.slug,
        role: m.role,
      })),
      currentWorkspaceId: defaultMembership.workspaceId,
      token,
    });
  });

  // Obter perfil do usuário autenticado
  app.get('/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user.sub },
      include: {
        memberships: {
          include: {
            workspace: true,
          },
        },
      },
    });

    if (!user) {
      return reply.status(404).send({ error: 'Usuário não encontrado' });
    }

    return reply.send({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      workspaces: user.memberships.map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        slug: m.workspace.slug,
        role: m.role,
      })),
      activeWorkspaceId: request.user.workspaceId,
    });
  });
}
