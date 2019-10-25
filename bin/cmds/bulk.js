const fs = require('fs-extra');
const path = require('path');
const ezpaarse = require('../..');
const logger = require('../../lib/logger')();
const {
  coerceHeaders,
  findInDir,
  isDir,
} = require('../../lib/utils');

const logReg = /\.(log|log\.gz)$/;

exports.command = 'bulk <sourceDir> [destDir]';
exports.aliases = ['b'];
exports.desc = 'Process files from a directory and store results';

exports.builder = (yargs) => yargs
  .option('header', {
    alias: ['H', 'headers'],
    describe: 'Add a header to the request',
    coerce: coerceHeaders,
  })
  .option('settings', {
    alias: 's',
    describe: 'Set a predefined setting',
  })
  .option('recursive', {
    alias: 'r',
    describe: 'Look for log files into subdirectories',
    boolean: true,
  })
  .option('download', {
    alias: 'd',
    describe: 'Download a file from the job directory',
  })
  .option('force', {
    alias: ['f', 'overwrite'],
    describe: 'Overwrite existing files',
    boolean: true,
  })
  .option('verbose', {
    alias: ['v'],
    describe: 'Shows detailed operations',
    boolean: true,
  })
  .option('list', {
    alias: 'l',
    describe: 'Only list log files in the directory',
    boolean: true,
  });

exports.handler = async (argv) => {
  const client    = ezpaarse.Client({ host: argv.host, proxy: argv.proxy });
  const sourceDir = path.resolve(argv.sourceDir);
  const destDir   = path.resolve(argv.destDir || argv.sourceDir);

  logger.setVerbose(!!argv.verbose);

  let hasError = false;

  if (!await isDir(sourceDir)) {
    logger.error(`Not a directory: ${sourceDir}`);
    process.exit(1);
  }
  if (!await isDir(destDir)) {
    logger.error(`Not a directory: ${destDir}`);
    process.exit(1);
  }

  const files = (await findInDir(sourceDir, argv.recursive)).filter((f) => logReg.test(f.name));

  if (files.length === 0) {
    logger.info('No log files found');
    return;
  }

  if (argv.list) {
    files.forEach((f) => console.log(f.path));
    return;
  }

  const startTime = process.hrtime();

  for (const file of files) {
    await processFile(file);
  }

  const elapsed = process.hrtime(startTime)[0];

  logger.verbose(`Terminated in ${elapsed}s`);

  process.exit(hasError ? 1 : 0);

  async function processFile(file) {
    const isGzip       = /\.gz$/i.test(file.name);
    const resultDir    = path.resolve(destDir, path.relative(sourceDir, path.dirname(file.path)));
    const resultFile   = path.resolve(resultDir, file.name.replace(logReg, '.ec.csv'));
    const reportFile   = path.resolve(resultDir, file.name.replace(logReg, '.report.json'));
    const resultFileGz = `${resultFile}.gz`;
    const tmpFile      = `${resultFile}.tmp`;
    const koFile       = `${resultFile}.ko`;

    if (await fs.pathExists(resultFile) && !argv.overwrite) {
      logger.verbose(`Skipping ${resultFile}`);
      return;
    }
    if (await fs.pathExists(resultFileGz) && !argv.overwrite) {
      logger.verbose(`Skipping ${resultFileGz}`);
      return;
    }

    logger.info(`Processing ${file.path}`);

    try {
      await fs.ensureDir(resultDir);
    } catch (e) {
      logger.error(`Failed to create ${resultDir}`);
      hasError = true;
      return;
    }

    try {
      await removeRelatedFiles(resultDir, file.name);
    } catch (e) {
      logger.error(`Failed to remove related files : ${e.message}`);
      hasError = true;
      return;
    }

    const { headers = {}, settings } = argv;

    if (isGzip && !headers['content-encoding']) {
      headers['content-encoding'] = 'gzip';
    }

    const job = client.createJob(fs.createReadStream(file.path), { headers, settings });
    let response;

    try {
      response = await job.start();
    } catch (e) {
      if (e.code === 'ECONNREFUSED') {
        logger.error(`${e.address}:${e.port} does not respond`);
        process.exit(1);
      }

      hasError = true;

      const res = e.response || {};
      const ezpaarseMessage = res && res.headers && res.headers['ezpaarse-status-message'];
      logger.error(`The job failed with status ${res.status || 'N/A'} ${res.statusText || 'N/A'}`);

      if (ezpaarseMessage) {
        logger.error(`ezPAARSE message : ${ezpaarseMessage}`);
      }

      try {
        logger.verbose(`Downloading ${path.basename(reportFile)}`);
        await downloadFile(job, 'job-report.json', reportFile);
      } catch (err) {
        logger.error(`Failed to download report file : ${err.message}`);
      }
      return;
    }

    logger.verbose(`Job started (ID: ${job.id || 'n/a'})`);

    try {
      await new Promise((resolve, reject) => {
        response.data.pipe(fs.createWriteStream(tmpFile))
          .on('error', reject)
          .on('finish', resolve);
      });

      if (!response.data.complete) {
        throw new Error('unexpected disconnection');
      }
    } catch (e) {
      hasError = true;
      logger.error(`The job has been interrupted : ${e.message}`);
    }

    try {
      await fs.move(tmpFile, hasError ? koFile : resultFile, { overwrite: true });
    } catch (err) {
      if (err.code !== 'ENOENT') {
        hasError = true;
        logger.error(`Failed to rename ${path.basename(tmpFile)} to ${hasError ? '.ko' : '.csv'} : ${err.message}`);
      }
    }

    try {
      logger.verbose(`Downloading ${path.basename(reportFile)}`);
      await downloadFile(job, 'job-report.json', reportFile);
    } catch (e) {
      hasError = true;
      logger.error(`Failed to download report file : ${e.message}`);
    }

    if (argv.download) {
      const downloads = Array.isArray(argv.download) ? argv.download : [argv.download];

      for (const jobFile of downloads) {
        const jobFileDest = path.resolve(resultDir, file.name.replace(logReg, `.${jobFile}`));
        try {
          logger.verbose(`Downloading ${jobFile}`);
          await downloadFile(job, jobFile, jobFileDest);
        } catch (e) {
          hasError = true;
          logger.error(`Failed to download ${jobFile} : ${e.message}`);
        }
      }
    }

    logger.verbose('Job terminated');
  }
};

/**
 * Remove all files with a name based on the given log file
 * @param {string} logFile path to a log file
 */
async function removeRelatedFiles(directory, filename) {
  const basename = filename.replace(logReg, '');

  const files = (await findInDir(directory))
    .filter((f) => f.name.startsWith(basename))
    .filter((f) => !logReg.test(f.name));

  for (const file of files) {
    logger.verbose(`Removing ${file.name}`);
    await fs.remove(file.path);
  }
}

/**
 * Download a file from the job directory to a given path
 * @param {Object} job the job to download the file
 * @param {string} filename the file to download
 * @param {string} dest the place to store the file to
 */
async function downloadFile(job, filename, dest) {
  if (!job.id) {
    return Promise.reject(new Error('Job has no ID'));
  }

  const response = await job.download(filename);

  return new Promise((resolve, reject) => {
    response.data
      .pipe(fs.createWriteStream(dest))
      .on('error', reject)
      .on('finish', resolve);
  });
}
