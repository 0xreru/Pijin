-- AlterTable
CREATE SEQUENCE token_id_seq;
ALTER TABLE "token" ALTER COLUMN "id" SET DEFAULT nextval('token_id_seq');
ALTER SEQUENCE token_id_seq OWNED BY "token"."id";
