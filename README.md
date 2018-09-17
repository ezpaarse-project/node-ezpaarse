# node-ezpaarse
Node wrapper for the ezPAARSE API

## Installation
```bash
npm install -g @ezpaarse-project/ezpaarse
```

## Usage
```bash
ezp --help
```

## Environnement variables
You can use environnement variables to set command options. Use the prefix "EZPAARSE_" followed by the option you want to set.
```bash
export EZPAARSE_SETTINGS=00-fr-bibcnrs
export EZPAARSE_VERBOSE=true
```

## Commands

### ezp process [files..]
Let you process one or more files with an instance of ezPAARSE. If no files are provided, the command will listen to `stdin`. The results are printed to `stdout`, unless you set an output file with `--out`.

```bash
  # Simple case
  ezp process ezproxy.log --out result.csv
  
  # Reading from stdin and redirecting stdout to file
  cat ezproxy.log | ezp process > result.csv
```

### ezp bulk <sourceDir> [destDir]
Process files in `sourceDir` and save results in `destDir`. If `destDir` is not provided, results will be stored in `sourceDir`, aside the source files. When processing files recursively with the `-r` option, `destDir` will mimic the structure of `sourceDir`. Files will use the same or Files with existing results are skipped, unless the `--force` flag is set. By default, the result file and the job report are downloaded, but you can get additionnal files from the job directory by using the `--download` option.

```bash
  # Simple case, processing files recursively from ezproxy-logs and storing results in ezproxy-results
  ezp bulk -r ezproxy-logs/ ezproxy-results/
  
  # Activating reject files and downloading unqualified log lines along results
  ezp bulk -r ezproxy-logs/ ezproxy-results/ -H "Reject-Files: all" --download lines-unqualified-ecs.log
```
