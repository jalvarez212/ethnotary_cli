const fs = require('fs');
const path = require('path');
const os = require('os');
const { ethers } = require('ethers');

const ETHNOTARY_DIR = path.join(os.homedir(), '.ethnotary');
const CONTACTS_PATH = path.join(ETHNOTARY_DIR, 'contacts.json');

// Ensure .ethnotary directory exists
function ensureDir() {
  if (!fs.existsSync(ETHNOTARY_DIR)) {
    fs.mkdirSync(ETHNOTARY_DIR, { recursive: true });
  }
}

// Load contacts file
function loadContacts() {
  if (!fs.existsSync(CONTACTS_PATH)) {
    return { contacts: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(CONTACTS_PATH, 'utf8'));
  } catch (e) {
    return { contacts: {} };
  }
}

// Save contacts file
function saveContacts(data) {
  ensureDir();
  fs.writeFileSync(CONTACTS_PATH, JSON.stringify(data, null, 2));
}

/**
 * Add or update a contact for an owner address
 * @param {string} address - Owner's Ethereum address
 * @param {Object} contactInfo - Contact methods { telegram, whatsapp, email, webhook }
 */
function addContact(address, contactInfo) {
  if (!ethers.isAddress(address)) {
    throw new Error(`Invalid address: ${address}`);
  }
  
  const normalizedAddress = ethers.getAddress(address);
  const data = loadContacts();
  
  // Merge with existing contact info
  data.contacts[normalizedAddress] = {
    ...data.contacts[normalizedAddress],
    ...contactInfo,
    updatedAt: new Date().toISOString()
  };
  
  saveContacts(data);
  return data.contacts[normalizedAddress];
}

/**
 * Get contact info for an address
 */
function getContact(address) {
  if (!ethers.isAddress(address)) {
    return null;
  }
  
  const normalizedAddress = ethers.getAddress(address);
  const data = loadContacts();
  return data.contacts[normalizedAddress] || null;
}

/**
 * Get contacts for multiple addresses
 */
function getContacts(addresses) {
  const data = loadContacts();
  const results = [];
  
  for (const address of addresses) {
    if (ethers.isAddress(address)) {
      const normalizedAddress = ethers.getAddress(address);
      const contact = data.contacts[normalizedAddress];
      if (contact) {
        results.push({
          address: normalizedAddress,
          ...contact
        });
      }
    }
  }
  
  return results;
}

/**
 * List all contacts
 */
function listContacts() {
  const data = loadContacts();
  return Object.entries(data.contacts).map(([address, info]) => ({
    address,
    ...info
  }));
}

/**
 * Remove a contact
 */
function removeContact(address) {
  if (!ethers.isAddress(address)) {
    throw new Error(`Invalid address: ${address}`);
  }
  
  const normalizedAddress = ethers.getAddress(address);
  const data = loadContacts();
  
  if (!data.contacts[normalizedAddress]) {
    throw new Error(`No contact found for address: ${address}`);
  }
  
  delete data.contacts[normalizedAddress];
  saveContacts(data);
}

module.exports = {
  addContact,
  getContact,
  getContacts,
  listContacts,
  removeContact,
  CONTACTS_PATH
};
