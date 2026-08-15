const { Command } = require('commander');
const { ethers } = require('ethers');
const { createOutput } = require('../../utils/output');
const { 
  addContact, 
  listContacts, 
  removeContact,
  getContact 
} = require('../../utils/contacts');

const contact = new Command('contact')
  .description('Owner contact management for notifications');

// contact add - Add or update owner contact info
contact
  .command('add')
  .description('Add or update contact info for an owner address')
  .requiredOption('--address <address>', 'Owner Ethereum address')
  .option('--telegram <chatId>', 'Telegram chat ID (numeric)')
  .option('--whatsapp <phone>', 'WhatsApp phone number (e.g., +15551234567)')
  .option('--email <email>', 'Email address for notifications')
  .option('--webhook <url>', 'Webhook URL for notifications')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      if (!ethers.isAddress(options.address)) {
        out.error(`Invalid address: ${options.address}`);
        return;
      }

      if (!options.telegram && !options.whatsapp && !options.email && !options.webhook) {
        out.error('At least one contact method required: --telegram, --whatsapp, --email, or --webhook');
        return;
      }

      const contactInfo = {};
      if (options.telegram) contactInfo.telegram = options.telegram;
      if (options.whatsapp) contactInfo.whatsapp = options.whatsapp;
      if (options.email) contactInfo.email = options.email;
      if (options.webhook) contactInfo.webhook = options.webhook;

      const saved = addContact(options.address, contactInfo);

      out.success(`Contact saved for ${options.address}`);
      out.print({
        address: ethers.getAddress(options.address),
        ...saved
      });

    } catch (error) {
      out.error(error.message);
    }
  });

// contact list - List all contacts
contact
  .command('list')
  .description('List all saved owner contacts')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      const contacts = listContacts();

      if (contacts.length === 0) {
        out.info('No contacts saved. Use "ethnotary contact add" to add one.');
        out.print({ contacts: [] });
        return;
      }

      out.print({
        count: contacts.length,
        contacts
      });

    } catch (error) {
      out.error(error.message);
    }
  });

// contact show - Show contact for specific address
contact
  .command('show')
  .description('Show contact info for a specific address')
  .requiredOption('--address <address>', 'Owner Ethereum address')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      if (!ethers.isAddress(options.address)) {
        out.error(`Invalid address: ${options.address}`);
        return;
      }

      const contactInfo = getContact(options.address);

      if (!contactInfo) {
        out.info(`No contact found for ${options.address}`);
        out.print({ address: options.address, contact: null });
        return;
      }

      out.print({
        address: ethers.getAddress(options.address),
        ...contactInfo
      });

    } catch (error) {
      out.error(error.message);
    }
  });

// contact remove - Remove a contact
contact
  .command('remove')
  .description('Remove contact info for an owner address')
  .requiredOption('--address <address>', 'Owner Ethereum address')
  .action(async (options, command) => {
    const globalOpts = command.parent.parent.opts();
    const out = createOutput(globalOpts);

    try {
      removeContact(options.address);
      out.success(`Contact removed for ${options.address}`);
      out.print({
        address: options.address,
        status: 'removed'
      });

    } catch (error) {
      out.error(error.message);
    }
  });

module.exports = contact;
