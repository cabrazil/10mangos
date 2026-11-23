# PostgreSQL do 10mangos (br-vmoracle)

## 1. Subir o container no servidor

```bash
# na sua máquina: copiar a pasta docker/ para o servidor
scp -r docker/ ubuntu@br-vmoracle:~/10mangos

# no servidor
cd ~/10mangos
cp .env.example .env
sed -i "s/TROQUE_ESTA_SENHA/$(openssl rand -hex 24)/" .env
mkdir -p backups && chmod +x backup.sh
docker compose up -d
docker compose ps            # aguarde STATUS "healthy"
docker compose logs -f db    # (Ctrl+C para sair)
```

Teste rápido:

```bash
docker exec -it 10mangos_postgres psql -U mangos -d 10mangos -c "select version();"
```

## 2. Conectar da máquina de desenvolvimento (túnel SSH — recomendado)

A porta fica só em `127.0.0.1:5433` do servidor, ou seja, **não fica exposta na internet**.

```bash
# deixe rodando em um terminal (ou use -fN para ir para background)
ssh -N -L 5433:127.0.0.1:5433 ubuntu@br-vmoracle
```

`.env` do projeto (raiz do 10mangos):

```env
DATABASE_URL="postgresql://mangos:<SENHA>@localhost:5433/10mangos?schema=public"
DIRECT_URL="postgresql://mangos:<SENHA>@localhost:5433/10mangos?schema=public"
```

> Sem Supabase não há pooler, então `DIRECT_URL` = `DATABASE_URL`.

Depois:

```bash
npx prisma migrate dev --name init
npx prisma migrate dev --create-only --name balance_triggers
# cole prisma/sql/balance_triggers.sql no migration.sql gerado e rode:
npx prisma migrate dev
```

O usuário `mangos` é superusuário do container, então o Prisma consegue criar o
*shadow database* do `migrate dev` sozinho.

## 3. (Opcional) Expor a porta publicamente

Só se precisar acessar sem túnel (ex.: app em outro servidor):

1. No `docker-compose.yml`, troque `127.0.0.1:${POSTGRES_PORT:-5433}:5432` por `${POSTGRES_PORT:-5433}:5432`.
2. Na Oracle Cloud: **VCN → Security List → Ingress Rule** TCP 5433 **somente para o seu IP**.

> ⚠️ O Docker insere regras próprias no iptables e **ignora o ufw**: com a porta
> publicada em `0.0.0.0`, quem controla o acesso é a Security List da Oracle.

## 4. Backup

```bash
./backup.sh                  # gera backups/10mangos_YYYYMMDD_HHMMSS.dump
crontab -e                   # 30 3 * * * /home/ubuntu/10mangos/backup.sh >> /home/ubuntu/10mangos/backups/backup.log 2>&1
```

Restaurar:

```bash
docker exec -it 10mangos_postgres pg_restore -U mangos -d 10mangos --clean --if-exists /backups/<arquivo>.dump
```
