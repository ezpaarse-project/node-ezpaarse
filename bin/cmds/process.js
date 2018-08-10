const fs = require('fs');
const path = require('path');
const ezpaarse = require('../..');
const { coerceHeaders, pick } = require('../../lib/utils');
const logger = require('../../lib/logger')({ stdout: process.stderr });

exports.command = 'process [files..]';
exports.aliases = ['p'];
exports.desc = 'Process a set of files';

exports.builder = yargs => yargs
  .option('o', {
    alias: ['out', 'output'],
    describe: 'Output file',
    coerce: file => path.resolve(file),
  })
  .option('H', {
    alias: ['header', 'headers'],
    describe: 'Add a header to the request',
    coerce: coerceHeaders,
  })
  .option('v', {
    alias: ['verbose'],
    describe: 'Shows detailed operations',
    boolean: true,
  })
  .option('s', {
    alias: 'settings',
    describe: 'Set a predefined setting',
  });

exports.handler = async (argv) => {
  const input     = argv.files || process.stdin;
  const client    = ezpaarse.Client(pick(argv, ['host', 'proxy']));
  const job       = client.createJob(input, pick(argv, ['settings', 'headers']));
  const startTime = process.hrtime();

  const { verbose } = argv;
  let response;

  try {
    response = await job.start();
  } catch (e) {
    if (e.code === 'ECONNREFUSED') {
      logger.error(`${e.address}:${e.port} does not respond`);
    } else {
      logger.error(e.message);
    }
    process.exit(1);
  }

  if (verbose) {
    logger.info(`Job started (ID: ${job.id || 'n/a'})`);
  }

  if (response.statusCode !== 200) {
    const ezpaarseMessage = response.headers['ezpaarse-status-message'];
    logger.error(`The job failed with status ${response.statusCode} ${response.statusMessage}`);
    if (ezpaarseMessage) { logger.error(`ezPAARSE message : ${ezpaarseMessage}`); }
    process.exit(1);
  }

  const output = argv.output ? fs.createWriteStream(argv.out) : process.stdout;

  response.on('end', () => {
    if (verbose) {
      const elapsed = process.hrtime(startTime)[0];
      logger.info(`Job terminated in ${elapsed}s`);
    }
  });

  response.pipe(output);
};
