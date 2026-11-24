import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ZodError } from 'zod';

import authPlugin from './plugins/auth.js';
import { authRoutes } from './routes/auth.routes.js';
import { accountRoutes } from './routes/accounts.routes.js';
import { categoryRoutes } from './routes/categories.routes.js';
import { transactionRoutes } from './routes/transactions.routes.js';
import { transferRoutes } from './routes/transfers.routes.js';
import { importRoutes } from './routes/imports.routes.js';
import { reportRoutes } from './routes/reports.routes.js';

const app = Fastify({
  logger: process.env.NODE_ENV === 'development',
});

async function bootstrap() {
  // 1. CORS
  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-workspace-id'],
  });

  // 2. JWT
  await app.register(jwt, {
    secret: process.env.JWT_SECRET || 'mangos-secret-dev-key',
  });

  // 3. Multipart para upload de arquivos (OFX, XLSX)
  await app.register(multipart, {
    limits: {
      fileSize: 20 * 1024 * 1024, // 20 MB
    },
  });

  // 4. Swagger Documentation
  await app.register(swagger, {
    openapi: {
      info: {
        title: '10mangos API',
        description: 'API de Controle Financeiro Pessoal Inteligente',
        version: '1.0.0',
      },
      servers: [
        {
          url: `http://localhost:${process.env.PORT || 3333}`,
          description: 'Servidor Local',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  // 5. Auth Plugin
  await app.register(authPlugin);

  // 6. Tratamento global de erros
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'Erro de Validação',
        issues: error.format(),
      });
    }

    app.log.error(error);
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    return reply.status(500).send({
      error: 'Erro interno do servidor',
      message,
    });
  });

  // 7. Rota de Health Check
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  app.get('/', async () => {
    return {
      name: '10mangos API',
      status: 'online',
      docs: '/docs',
    };
  });

  // 8. Registro de Rotas da API
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(accountRoutes, { prefix: '/api/accounts' });
  await app.register(categoryRoutes, { prefix: '/api/categories' });
  await app.register(transactionRoutes, { prefix: '/api/transactions' });
  await app.register(transferRoutes, { prefix: '/api/transfers' });
  await app.register(importRoutes, { prefix: '/api/imports' });
  await app.register(reportRoutes, { prefix: '/api/reports' });

  // 9. Iniciar o servidor
  const port = Number(process.env.PORT) || 3333;
  const host = process.env.HOST || '0.0.0.0';

  try {
    await app.listen({ port, host });
    console.log(`🚀 10mangos API rodando em http://${host}:${port}`);
    console.log(`📚 Documentação Swagger disponível em http://localhost:${port}/docs`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

bootstrap();
