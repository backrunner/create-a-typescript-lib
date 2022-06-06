import inquirer from 'inquirer';
import path from 'path';

export const isRetry = () => {
  return process.argv.reduce((res, curr) => {
    if (res) return res;
    if (curr === '-r' || curr === '--retry') {
      return true;
    }
    return res;
  }, false);
};

export const getActualProjectPath = async (projectName: string) => {
  let actualProjectName = projectName;
  if (projectName.includes('/')) {
    actualProjectName = projectName.slice(Math.min(projectName.lastIndexOf('/') + 1, projectName.length - 1));
  }
  if (!actualProjectName?.length) {
    throw new Error('Invalid project name.');
  }
  if (actualProjectName === projectName) {
    return {
      projectPath: path.resolve(process.cwd(), projectName),
      projectName: projectName,
    };
  }
  const res = await inquirer.prompt([
    {
      type: 'list',
      name: 'folderName',
      message: 'Which folder name you want to use?',
      choices: [projectName, actualProjectName],
    },
  ]);
  return {
    projectPath: path.resolve(process.cwd(), res.folderName),
    projectFolderName: res.folderName,
  };
};
