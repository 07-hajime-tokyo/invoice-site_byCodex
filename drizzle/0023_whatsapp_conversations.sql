CREATE TABLE IF NOT EXISTS `whatsapp_conversations` (
  `id` int AUTO_INCREMENT PRIMARY KEY NOT NULL,
  `name` varchar(255) NOT NULL,
  `isGroup` boolean NOT NULL DEFAULT false,
  `lastMessageAt` timestamp NULL,
  `firstMessageAt` timestamp NULL,
  `importedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `whatsapp_conversations_name_unique` UNIQUE(`name`)
);

CREATE TABLE IF NOT EXISTS `whatsapp_messages` (
  `id` int AUTO_INCREMENT PRIMARY KEY NOT NULL,
  `conversationId` int NOT NULL,
  `sender` varchar(255) NOT NULL,
  `isOutgoing` boolean NOT NULL DEFAULT false,
  `sentAt` timestamp NOT NULL,
  `body` mediumtext NOT NULL,
  `bodyJa` mediumtext,
  `translationSkipped` boolean NOT NULL DEFAULT false,
  `dedupeKey` varchar(64) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `whatsapp_messages_dedupeKey_unique` UNIQUE(`dedupeKey`),
  INDEX `idx_whatsapp_messages_conversation` (`conversationId`, `sentAt`)
);
