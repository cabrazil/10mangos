import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      email: string;
      workspaceId: string;
    };
    user: {
      sub: string;
      email: string;
      workspaceId: string;
    };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async function authPlugin(app: FastifyInstance) {
  app.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();

      // Permitir sobrescrever o workspaceId via header 'x-workspace-id'
      const requestedWorkspaceId = request.headers['x-workspace-id'] as string | undefined;
      if (requestedWorkspaceId) {
        request.user.workspaceId = requestedWorkspaceId;
      }
    } catch (err) {
      return reply.status(401).send({ error: 'Não autorizado', message: 'Token inválido ou expirado' });
    }
  });
});
