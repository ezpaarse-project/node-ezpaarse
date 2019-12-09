/* eslint-disable no-console */
const chalk = require('chalk');
const { Console } = require('console');

module.exports = function createLogger(options) {
  const { stdout = process.stdout, stderr = process.stderr } = options || {};
  let { verbose = false } = options || {};

  const logger = new Console(stdout, stderr);

  return {
    setVerbose(bool) { verbose = !!bool; },
    info(message) { logger.info(log('Info', 'blue', message)); },
    warning(message) { logger.error(log('Warning', 'orange', message)); },
    error(message) { logger.error(log('Error', 'red', message)); },
    verbose(message) {
      if (verbose) { logger.info(log('Verbose', 'cyan', message)); }
    },
  };
};


function log(prefix, color, message) {
  const coloredPrefix = chalk[color](`[${prefix}]`.padEnd(9));
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');
  const time = chalk.grey(`[${hours}:${minutes}:${seconds}]`);
  return `${time}${coloredPrefix} ${message}`;
}
