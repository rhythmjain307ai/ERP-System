const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function testDatabase() {
  try {
    const companyCount = await prisma.company.count();

    console.log("Prisma database query successful!");
    console.log("Number of companies:", companyCount);
  } catch (error) {
    console.error("Prisma query failed:");
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

testDatabase();