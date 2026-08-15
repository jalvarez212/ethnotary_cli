const { getContacts } = require('./contacts');

const DEFAULT_BASE_URL = 'https://ethnotary.io';

/**
 * Generate approval URL for a transaction
 * @param {number} txId - Transaction ID
 * @param {string} network - Network name (e.g., 'sepolia')
 * @param {string} contractAddress - MultiSig contract address
 * @returns {string} Approval URL
 */
function generateApprovalUrl(txId, network, contractAddress) {
  const baseUrl = process.env.ETHNOTARY_BASE_URL || DEFAULT_BASE_URL;
  return `${baseUrl}/app/views/txn.html?txid=${txId}&network=${network}&address=${contractAddress}`;
}

/**
 * Format approval request message
 * @param {Object} txData - Transaction data
 * @returns {string} Formatted message
 */
function formatApprovalMessage(txData) {
  const lines = [
    '🔔 MultiSig Approval Request',
    '',
    `Transaction #${txData.id} on ${txData.network}`,
    `To: ${txData.destination}`,
  ];

  if (txData.value && txData.value !== '0 ETH') {
    lines.push(`Value: ${txData.value}`);
  }

  if (txData.data && txData.data !== '0x') {
    lines.push(`Data: ${txData.data.slice(0, 20)}...`);
  }

  lines.push('');
  lines.push(`Confirmations: ${txData.confirmations}/${txData.required}`);
  lines.push('');
  lines.push(`👉 Review & Approve: ${txData.approvalUrl}`);

  return lines.join('\n');
}

/**
 * Get notification data for other owners (excluding sender)
 * @param {string[]} owners - Array of owner addresses
 * @param {string} senderAddress - Address of the transaction sender
 * @param {Object} txData - Transaction data for message formatting
 * @returns {Array} Array of notification objects for each owner with contact info
 */
function getNotificationData(owners, senderAddress, txData) {
  // Filter out the sender
  const otherOwners = owners.filter(
    addr => addr.toLowerCase() !== senderAddress.toLowerCase()
  );

  // Get contacts for other owners
  const contacts = getContacts(otherOwners);

  // Build notification data for each owner with contact info
  const notifications = [];

  for (const owner of otherOwners) {
    const contact = contacts.find(
      c => c.address.toLowerCase() === owner.toLowerCase()
    );

    if (contact && (contact.telegram || contact.whatsapp || contact.webhook)) {
      notifications.push({
        address: owner,
        telegram: contact.telegram || null,
        whatsapp: contact.whatsapp || null,
        webhook: contact.webhook || null,
        message: formatApprovalMessage(txData)
      });
    }
  }

  return notifications;
}

/**
 * Build complete notification payload for a transaction
 * @param {Object} params - Parameters
 * @param {number} params.transactionId - Transaction ID
 * @param {string} params.network - Network name
 * @param {string} params.contractAddress - MultiSig address
 * @param {string} params.destination - Transaction destination
 * @param {string} params.value - Transaction value
 * @param {string} params.data - Transaction data
 * @param {number} params.confirmations - Current confirmation count
 * @param {number} params.required - Required confirmations
 * @param {string[]} params.owners - Array of owner addresses
 * @param {string} params.senderAddress - Sender's address
 * @returns {Object} Notification payload
 */
function buildNotificationPayload(params) {
  const approvalUrl = generateApprovalUrl(
    params.transactionId,
    params.network,
    params.contractAddress
  );

  const txData = {
    id: params.transactionId,
    network: params.network,
    destination: params.destination,
    value: params.value,
    data: params.data,
    confirmations: params.confirmations,
    required: params.required,
    approvalUrl
  };

  const notifyOwners = getNotificationData(
    params.owners,
    params.senderAddress,
    txData
  );

  return {
    approvalUrl,
    notifyOwners,
    message: formatApprovalMessage(txData)
  };
}

module.exports = {
  generateApprovalUrl,
  formatApprovalMessage,
  getNotificationData,
  buildNotificationPayload
};
