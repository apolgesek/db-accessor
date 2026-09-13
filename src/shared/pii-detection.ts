export type PiiEntityType =
  | 'PERSON'
  | 'EMAIL_ADDRESS'
  | 'PHONE_NUMBER'
  | 'DATE_OF_BIRTH'
  | 'ADDRESS'
  | 'POSTAL_CODE'
  | 'CREDIT_CARD'
  | 'IBAN_CODE'
  | 'IP_ADDRESS';

export type DetectPiiItem = {
  id: string;
  path: string;
  value: string | number;
};

export type DetectPiiRequest = {
  version: 1;
  items: DetectPiiItem[];
};

export type PiiEvidence = {
  source: 'PATH_RULE' | 'VALUE_VALIDATOR';
  ruleId: string;
  confidence: number;
};

export type PiiDetection = {
  entityType: PiiEntityType;
  confidence: number;
  evidence: PiiEvidence[];
};

export type DetectPiiResult = {
  id: string;
  path: string;
  status: 'DETECTED' | 'NOT_DETECTED' | 'UNSUPPORTED_PATH';
  detections: PiiDetection[];
};

export type DetectPiiResponse = {
  version: 1;
  results: DetectPiiResult[];
};
