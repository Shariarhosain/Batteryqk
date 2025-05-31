// utils/createNotification.js
import prisma from './prismaClient.js';
import { translate } from './i18n.js'; // Assuming translate can fetch specific language strings

/**
 * Creates a notification.
 * Saves the notification content (title, message) in English to the database.
 * The 'langForDBRecord' parameter can store the original language context of the event,
 * but the actual title/message fields in the DB will be English.
 */
const createNotification = async (
  userId,                   // The ID of the user to whom the notification is directed
  type,                     // NotificationType enum (e.g., SYSTEM, MESSAGE, etc.)
  titleKey,                 // i18n key for the notification title
  messageKey,               // i18n key for the notification message
  langForDBRecord = 'en',   // Language context of the event (e.g., user's preferred lang at the time)
  entityId = null,          // Optional: ID of related entity (e.g., post ID, user ID)
  entityType = null,        // Optional: Type of related entity (e.g., "Post", "User")
  link = null,              // Optional: A link for the notification to redirect to
  templateData = {}         // Data for placeholders in translation strings (e.g., { name: "John" })
) => {
  // --- Always generate English title and message for Database storage ---
  const titleForDB = translate(titleKey, 'en', templateData);
  const messageForDB = translate(messageKey, 'en', templateData);

  try {
    const notification = await prisma.notification.create({
      data: {
        userId,
        type,
        title: titleForDB,      // Store English title in DB
        message: messageForDB,  // Store English message in DB
        entityId: entityId ? String(entityId) : null,
        entityType,
        link,
        // read: false, // Assuming your Prisma schema has a 'read' field defaulting to false
      },
    });
    // Log with the English version that was saved to DB
    console.log(`DB Notification created for user ${userId}: ${titleForDB} (Event lang context: ${langForDBRecord})`);
    return notification; // Returns the notification object (with English content from DB)
  } catch (error) {
    console.error('Error creating DB notification:', error);
    // throw error; // Optionally re-throw to allow caller to handle or stop execution
    return null;    // Or return null to indicate failure, and caller can check
  }
};

export { createNotification };