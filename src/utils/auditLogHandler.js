import prisma from './prismaClient.js';

const recordAuditLog = async (action, details) => {
  const { userId, entityName, entityId, oldValues, newValues, description, ipAddress, userAgent } = details;
  try {
    await prisma.auditLog.create({
      data: {
        action,
        userId: userId || null,
        entityName: entityName || null,
        entityId: entityId ? String(entityId) : null,
        oldValues: oldValues || undefined, // Prisma expects JsonNull or undefined for optional Json
        newValues: newValues || undefined,
        description: description || null,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
      },
    });
    console.log(`Audit log recorded: ${action} on ${entityName || 'system'}`);
  } catch (error) {
    console.error('Error recording audit log:', error);
  }
};

export { recordAuditLog };