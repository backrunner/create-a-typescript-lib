/* eslint-disable complexity */
/* eslint-disable no-console */
import childProcess from 'child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';
import path from 'path';
import ejs from 'ejs';
import fs from 'fs';
import fsp from 'fs/promises';
import spdxList from 'spdx-license-ids';
import UserDataStorage from 'userdata-storage';
import { getLicense } from 'license';
import README_TEMPLATE from './templates/Readme.md.ejs';
import { repos } from './consts';
import { getActualProjectPath, isRetry } from './utils';

interface UserInfo {
  name: string;
  cliName: string;
  desc: string;
  author: string;
  version: string;
  license: string;
  useGit: boolean;
}

interface GitOptions {
  commitMsg: string;
}

const UNNECESSARY_FILES = ['./CHANGELOG.md'];
const UNNECESSARY_PACKAGE_INFO = ['keywords', 'bugs', 'repository', 'homepage'];
const LAST_USER_INFO_KEY = 'last-user-info';
const LAST_GIT_OPTIONS_KEY = 'last-git-options';

const licenseIds = spdxList.map((item) => item.toLowerCase());
const userStorage = new UserDataStorage('create-a-typescript-lib', 'storage');

const init = async () => {
  let userInfo: UserInfo | null = null;
  if (isRetry()) {
    const stored = (await userStorage.get(LAST_USER_INFO_KEY)) as UserInfo;
    if (stored) {
      userInfo = stored;
    } else {
      console.warn(chalk.yellow('Cannot find stored information of the last try.'));
    }
  }
  if (!userInfo) {
    // input info
    console.log(chalk.cyan('We need some necessary information to initialize your typescript cli project:'));
    userInfo = (await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Project Name: ',
        validate: (v: string) => {
          if (!v) {
            return 'Project name should not be empty.';
          }
          return true;
        },
      },
      {
        type: 'input',
        name: 'desc',
        message: 'Description: ',
        default: '',
      },
      {
        type: 'input',
        name: 'version',
        message: 'Version: ',
        default: '0.0.0',
      },
      {
        type: 'input',
        name: 'author',
        message: 'Author: ',
        default: '',
      },
      {
        type: 'input',
        name: 'license',
        message: 'License: ',
        default: 'MIT',
        validate: (v: string) => {
          return licenseIds.includes(v.toLowerCase())
            ? true
            : 'Invalid license name (the license name should in the SPDX License List).\nSee https://spdx.org/licenses/ for more details.';
        },
      },
      {
        type: 'confirm',
        name: 'useGit',
        message: 'Do you want to use Git to manage your project?',
        default: true,
      },
    ])) as UserInfo;
  }

  if (!userInfo) {
    console.error(chalk.red('Invalid user project information.'));
    return;
  } else {
    await userStorage.set(LAST_USER_INFO_KEY, userInfo);
  }

  let gitOptions: GitOptions | null = null;

  if (isRetry()) {
    const stored = (await userStorage.get(LAST_USER_INFO_KEY)) as GitOptions;
    if (stored) {
      gitOptions = stored;
    } else {
      console.warn(chalk.yellow('Cannot find stored git options of the last try.'));
    }
  }

  if (userInfo.useGit) {
    if (!gitOptions) {
      gitOptions = (await inquirer.prompt([
        {
          type: 'input',
          name: 'commitMsg',
          message: 'First commit message: ',
          default: 'First commit',
        },
      ])) as GitOptions;
      await userStorage.set(LAST_GIT_OPTIONS_KEY, gitOptions);
    }
  } else {
    await userStorage.remove(LAST_GIT_OPTIONS_KEY);
  }

  // check conflict
  const { projectPath, projectFolderName } = await getActualProjectPath(userInfo.name);
  if (fs.existsSync(projectPath)) {
    const stat = await fsp.stat(projectPath);
    if (stat.isDirectory()) {
      const confirm = await inquirer.prompt({
        type: 'confirm',
        name: 'v',
        message: `The folder named ${userInfo.name} already exists in the current directory, do you want to continue creating your project?`,
        default: false,
      });
      if (!confirm.v) {
        return;
      }
      const delConfirm = await inquirer.prompt({
        type: 'confirm',
        name: 'v',
        message: 'Do you want to empty the directory and then create the project?',
        default: false,
      });
      if (!delConfirm.v) {
        return;
      }
      try {
        await fsp.rm(projectPath, { recursive: true, force: true });
      } catch (err) {
        console.error(chalk.red('Cannot delete the project folder, please try to init your project again.'));
        throw err;
      }
      try {
        await fsp.mkdir(projectPath, { recursive: true });
      } catch (err) {
        console.error(chalk.red('Cannot create the project folder, please try to init your project again.'));
        throw err;
      }
    }
  } else {
    try {
      await fsp.mkdir(projectPath, { recursive: true });
    } catch (err) {
      console.error(chalk.red('Cannot create the project folder, please try to init your project again.'));
      throw err;
    }
  }

  // clone boilerplate
  console.log(chalk.green('Very well, we will clone the boilerplate into the project folder now.'));
  const branch = 'main';
  try {
    console.log(chalk.cyan('Cloning the boilerplate to the project folder...'));
    childProcess.execSync(`git clone ${repos.defaultBoilerplate} -b ${branch} --depth 1 .`, {
      cwd: projectPath,
    });
  } catch (err) {
    console.error(chalk.red('Cannot clone the boilerplate due toan error, please try to init your project again.'));
    throw err;
  }
  // delete unnecessary files
  try {
    console.log(chalk.cyan('Cleaning up your workspace...'));
    await Promise.all(
      UNNECESSARY_FILES.map((filePath) => {
        return fsp.rm(path.resolve(projectPath, filePath), { force: true });
      }),
    );
  } catch (err) {
    console.error(chalk.red('Cannot clean up your workspace due to an error, please try to init your project again.'));
    throw err;
  }
  // install dependencies
  console.log(chalk.green('Looks good, we need to do some final work to finish the initialization, please stand by.'));
  try {
    console.log(chalk.cyan('Installing the dependencies, please wait for a minute...'));
    childProcess.execSync('npm install', {
      cwd: projectPath,
    });
  } catch (err) {
    console.error(chalk.red('Cannot install the dependencies due to an error, please try to init your project again.'));
    throw err;
  }

  // update package.json
  const packageInfoPath = path.resolve(projectPath, './package.json');
  if (fs.existsSync(packageInfoPath)) {
    const packageInfo = JSON.parse(fs.readFileSync(packageInfoPath, { encoding: 'utf8' }));
    const { name, author, license, desc, version } = userInfo;
    Object.assign(packageInfo, {
      name,
      author,
      license,
      version,
      description: desc,
    });
    packageInfo.main = `dist/${name}.umd.js`;
    packageInfo.module = `dist/${name}.esm.js`;
    UNNECESSARY_PACKAGE_INFO.forEach((key) => {
      delete packageInfo[key];
    });
    try {
      fs.writeFileSync(packageInfoPath, JSON.stringify(packageInfo, null, '  '), {
        encoding: 'utf-8',
      });
    } catch (err) {
      console.warn(
        chalk.yellow(
          'Cannot update the package.json due to an error, perhaps you need to modify it manually by yourself.',
        ),
      );
      console.warn(err);
    }
  } else {
    console.warn(
      chalk.yellow('Cannot find an available package.json, perhaps you need to modify it manually by yourself.'),
    );
  }

  // remove existed Readme.md
  const potentialReadmePath = ['./reamde.md', './README.md', './Readme.md'];
  const readmePath = path.resolve(projectPath, './Readme.md');
  const readmeExists = potentialReadmePath.reduce(
    (res, item) => {
      if (res.exists) {
        return res;
      }
      const itemPath = path.resolve(projectPath, item);
      if (fs.existsSync(itemPath)) {
        return {
          exists: true,
          path: itemPath,
        };
      }
      return res;
    },
    {
      exists: false,
      path: '',
    },
  );

  // write new Readme.md
  let deleteReadmeError = false;
  if (readmeExists.exists) {
    try {
      await fsp.rm(readmeExists.path, { force: true });
    } catch (err) {
      console.warn('Cannot write the readme file, perhaps you need to modify it manually by yourself.');
      console.warn(err);
      deleteReadmeError = true;
    }
  }
  if (!deleteReadmeError) {
    try {
      await fsp.writeFile(
        readmePath,
        ejs.render(README_TEMPLATE, {
          name: userInfo.name,
          desc: userInfo.desc,
          license: userInfo.license,
        }),
        { encoding: 'utf-8' },
      );
    } catch (err) {
      console.warn(chalk.yellow('Cannot update the readme file, perhaps you need to modify it manually by yourself.'));
      console.warn(err);
    }
  }

  // clean license file
  const potentialLicensePath = ['./license', './LICENSE', './License'];
  const licenseExists = potentialLicensePath.reduce(
    (res, item) => {
      if (res.exists) {
        return res;
      }
      const itemPath = path.resolve(projectPath, item);
      if (fs.existsSync(itemPath)) {
        return {
          exists: true,
          path: itemPath,
        };
      }
      return res;
    },
    {
      exists: false,
      path: '',
    },
  );
  let deleteLicenseError = false;
  if (licenseExists.exists) {
    try {
      await fsp.rm(licenseExists.path, { force: true });
    } catch (err) {
      console.warn('Cannot delete the license file, perhaps you need to modify it manually by yourself.');
      console.warn(err);
      deleteLicenseError = true;
    }
  }

  // write new license file
  if (!deleteLicenseError) {
    const licensePath = path.resolve(projectPath, './LICENSE');
    const licenseContent = getLicense(userInfo.license, {
      author: userInfo.author,
      year: `${new Date().getFullYear()}`,
    });
    if (licenseContent) {
      try {
        await fsp.writeFile(licensePath, licenseContent, { encoding: 'utf-8' });
      } catch (err) {
        console.warn('Cannot update the license file, perhaps you need to modify it manually by yourself.');
        console.warn(err);
      }
    } else {
      console.warn('Cannot generate the license file, perhaps you need to modify it manually by yourself.');
    }
  }

  // setup git
  const gitDataPath = path.resolve(projectPath, './.git');
  if (fs.existsSync(gitDataPath)) {
    // whether user determined, remove the original .git folder
    try {
      await fsp.rm(gitDataPath, { recursive: true, force: true });
    } catch (err) {
      console.error(
        chalk.red(
          'Cannot reset the git repository, perhaps you need to initialize the git repository manually by yourself.',
        ),
      );
      throw err;
    }
  }
  if (userInfo.useGit) {
    console.log(chalk.cyan('Initializing your git repository...'));
    try {
      childProcess.execSync(`git init && git add . && git commit -m "${gitOptions?.commitMsg || 'First commit'}"`, {
        cwd: projectPath,
      });
    } catch (err) {
      console.error(
        chalk.red(
          'Cannot initialize the git repository, perhaps you need to initialize the git repository manually by yourself.',
        ),
      );
      throw err;
    }
  }

  // done
  console.log(
    chalk.green(
      `\nAll things done. :D\nYou can build up your project now!\n\nCommands to build your project: \n\ncd ./${projectFolderName || userInfo.name}\nnpm run build\n`,
    ),
  );
};

// execute

init();
