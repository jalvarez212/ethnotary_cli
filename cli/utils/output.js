const chalk = require('chalk');
const ora = require('ora');

class Output {
  constructor(options = {}) {
    this.jsonMode = options.json || false;
    this.spinner = null;
  }

  // Output data - JSON if --json flag, formatted otherwise
  print(data, options = {}) {
    if (this.jsonMode) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      if (options.title) {
        console.log(chalk.bold(options.title));
      }
      if (typeof data === 'string') {
        console.log(data);
      } else {
        this.printFormatted(data);
      }
    }
  }

  printFormatted(data, indent = 0) {
    const prefix = '  '.repeat(indent);
    if (Array.isArray(data)) {
      data.forEach((item, i) => {
        if (typeof item === 'object') {
          console.log(`${prefix}${chalk.dim(`[${i}]`)}`);
          this.printFormatted(item, indent + 1);
        } else {
          console.log(`${prefix}- ${item}`);
        }
      });
    } else if (typeof data === 'object' && data !== null) {
      Object.entries(data).forEach(([key, value]) => {
        if (typeof value === 'object' && value !== null) {
          console.log(`${prefix}${chalk.cyan(key)}:`);
          this.printFormatted(value, indent + 1);
        } else {
          console.log(`${prefix}${chalk.cyan(key)}: ${value}`);
        }
      });
    } else {
      console.log(`${prefix}${data}`);
    }
  }

  success(message) {
    if (!this.jsonMode) {
      console.log(chalk.green('✓'), message);
    }
  }

  error(message, exitCode = 1) {
    if (this.jsonMode) {
      console.log(JSON.stringify({ error: message }));
    } else {
      console.error(chalk.red('✗'), message);
    }
    process.exit(exitCode);
  }

  warn(message) {
    if (!this.jsonMode) {
      console.log(chalk.yellow('⚠'), message);
    }
  }

  info(message) {
    if (!this.jsonMode) {
      console.log(chalk.blue('ℹ'), message);
    }
  }

  // Spinner - no-op in JSON mode
  startSpinner(text) {
    if (!this.jsonMode) {
      this.spinner = ora(text).start();
    }
  }

  updateSpinner(text) {
    if (this.spinner) {
      this.spinner.text = text;
    }
  }

  succeedSpinner(text) {
    if (this.spinner) {
      this.spinner.succeed(text);
      this.spinner = null;
    }
  }

  failSpinner(text) {
    if (this.spinner) {
      this.spinner.fail(text);
      this.spinner = null;
    }
  }

  stopSpinner() {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
  }
}

// Create output instance from command options
function createOutput(options) {
  return new Output({
    json: options.json || options.parent?.opts()?.json || false
  });
}

module.exports = {
  Output,
  createOutput
};
