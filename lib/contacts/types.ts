export interface EmailPattern {
  pattern: string;
  domain: string;
  confidence: number;
  sampleSize: number;
  sampleEmails: string[];
  sources: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface DiscoveredEmail {
  address: string;
  confidence: number;
  source: 'pattern' | 'github' | 'careers' | 'public' | 'sec';
  verified: boolean;
  verifiedAt?: Date;
}

export interface DiscoveredPhone {
  number: string;
  type: 'work' | 'mobile';
  source: string;
}

export interface EnrichedContact {
  firstName: string;
  lastName: string;
  company: string;
  domain: string;
  title: string;
  linkedinUrl?: string;
  emails: DiscoveredEmail[];
  phones: DiscoveredPhone[];
  socialProfiles: {
    linkedin?: string;
    twitter?: string;
    github?: string;
  };
  discoveredAt: Date;
}

export interface ContactDiscoveryRequest {
  firstName: string;
  lastName: string;
  company: string;
  domain?: string;
  linkedinUrl?: string;
}

export interface ContactDiscoveryResult {
  contact: EnrichedContact;
  cached: boolean;
  discoveryTimeMs: number;
}

export interface BulkDiscoveryRequest {
  profiles: ContactDiscoveryRequest[];
}

export interface ContactList {
  id: string;
  userId: string;
  name: string;
  description?: string;
  itemCount: number;
  createdAt: Date;
}

export type ExportFormat = 'csv' | 'json' | 'vcard';

export const EMAIL_PATTERN_TEMPLATES = [
  '{first}.{last}',
  '{first}{last}',
  '{f}{last}',
  '{first}',
  '{first}_{last}',
  '{last}.{first}',
  '{last}{first}',
  '{f}.{last}',
  '{first}.{l}',
  '{f}{l}',
] as const;
