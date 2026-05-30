import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface CertificateResources {
  regionalAcmCertificate: acm.ICertificate;
}

export function importCertificateResources(scope: Construct, projectName: string): CertificateResources {
  const regionalCertificateArn = ssm.StringParameter.valueForStringParameter(
    scope,
    `/${projectName}/acm/regional-certificate-arn`,
  );
  const regionalAcmCertificate = acm.Certificate.fromCertificateArn(
    scope,
    `${projectName}-regional-domain-cert`,
    regionalCertificateArn,
  );

  return { regionalAcmCertificate };
}
