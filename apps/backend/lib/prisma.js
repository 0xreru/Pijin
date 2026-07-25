"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
var client_1 = require("@prisma/client");
var prismaClientSingleton = function () {
    var connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("Missing DATABASE_URL");
    }
    if (connectionString.startsWith("postgres://") || connectionString.startsWith("postgresql://")) {
        var PrismaPg = require("@prisma/adapter-pg").PrismaPg;
        var adapter = new PrismaPg({ connectionString: connectionString });
        return new client_1.PrismaClient({ adapter: adapter });
    }
    return new client_1.PrismaClient();
};
exports.prisma = (_a = globalThis.prismaGlobal) !== null && _a !== void 0 ? _a : prismaClientSingleton();
if (process.env.NODE_ENV !== 'production')
    globalThis.prismaGlobal = exports.prisma;
