import * as fs from 'fs';
import * as path from 'path';
import * as handlebars from 'handlebars';

/**
 * Templating function to render .hbs files in a directory.
 *
 * @param dirPath - The path to the directory containing .hbs template files.
 * @param data - The data object to pass to the templating engine.
 */
export function templateDirectory(dirPath: string, data: Record<string, unknown>): void {
  const files = fs.readdirSync(dirPath);

  const hbsFiles = files.filter(file => file.endsWith('.hbs'));

  hbsFiles.forEach(file => {
    const templatePath = path.join(dirPath, file);

    const templateContent = fs.readFileSync(templatePath, 'utf8');
    const template = handlebars.compile(templateContent, { strict: true });

    const renderedContent = template(data);

    const outputFileName = file.slice(0, -4);
    const outputPath = path.join(dirPath, outputFileName);

    fs.writeFileSync(outputPath, renderedContent, 'utf8');
  });
}
