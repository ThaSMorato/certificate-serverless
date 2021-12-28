import { APIGatewayProxyHandler } from "aws-lambda";
import { S3 } from "aws-sdk";
import chromium from "chrome-aws-lambda";
import dayjs from "dayjs";
import handlebars from "handlebars";
import { join } from "path";
import { readFileSync } from "fs";

import { document } from "../utils/dynamodbClient";

interface ICreateCertificate {
  id: string;
  name: string;
  grade: string;
}

interface ITemplate {
  id: string;
  name: string;
  grade: string;
  date: string;
  medal: string;
}

const compile = async (data: ITemplate) => {
  const filePath = join(process.cwd(), "src", "templates", "certificate.hbs");

  const html = readFileSync(filePath, "utf8");

  return handlebars.compile(html)(data);
};

const createCertificate = async ({ id, name, grade }: ICreateCertificate) => {
  await document
    .put({
      TableName: "users_certificates",
      Item: {
        id,
        name,
        grade,
      },
    })
    .promise();

  const medalPath = join(process.cwd(), "src", "templates", "selo.png");
  const medal = readFileSync(medalPath, "base64");

  const data: ITemplate = {
    id,
    name,
    grade,
    medal,
    date: dayjs().format("DD/MM/YYYY"),
  };

  const content = await compile(data);

  const browser = await chromium.puppeteer.launch({
    headless: true,
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
  });

  const page = await browser.newPage();

  await page.setContent(content);

  const pdf = await page.pdf({
    format: "a4",
    landscape: true,
    path: process.env.IS_OFFLINE ? "certificate.pdf" : null,
    printBackground: true,
    preferCSSPageSize: true,
  });

  await browser.close();

  const s3 = new S3();

  await s3
    .putObject({
      Bucket: "certificateignitebucket",
      Key: `${id}.pdf`,
      ACL: "public-read",
      Body: pdf,
      ContentType: "application/pdf",
    })
    .promise();
};

export const handle: APIGatewayProxyHandler = async (event) => {
  const { id, name, grade } = JSON.parse(event.body) as ICreateCertificate;

  const response = await document
    .query({
      TableName: "users_certificates",
      KeyConditionExpression: "id = :id",
      ExpressionAttributeValues: {
        ":id": id,
      },
    })
    .promise();

  const userAlreadyExists = response.Items[0];

  if (!userAlreadyExists) {
    await createCertificate({ id, name, grade });
  }

  return {
    statusCode: 201,
    body: JSON.stringify({
      message: "Certificate created successfully!",
      url: `https://certificateignitebucket.s3.sa-east-1.amazonaws.com/${id}.pdf`,
    }),
    headers: {
      "Content-Type": "application/json",
    },
  };
};
