export interface Settings {
  geminiApiKey: string;
  approvalRequired: {
    low: boolean;
    medium: boolean;
    high: boolean;
  };
  writingTone: string;
  emailSignature: string;
  userName: string;
  maxEmails: number;
  theme: string;
}

export interface MockEmail {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  date: string;
  from: string;
  to: string;
  subject: string;
  body: string;
}

export interface GmailMessagePart {
  mimeType: string;
  body?: {
    data?: string;
  };
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload: {
    mimeType: string;
    headers: { name: string; value: string }[];
    body: {
      data: string;
    };
    parts?: GmailMessagePart[];
  };
}

export interface GmailThread {
  id: string;
  messages: GmailMessage[];
}

export interface QueuedAction {
  id: string;
  type: string;
  params: any;
  riskLevel: string;
  reason: string;
  status: string; // 'pending' | 'approved' | 'rejected' | 'executed' | 'failed'
  timestamp: number;
  completedAt: number | null;
  result: any;
  error: string | null;
}

export interface ExtensionMessage {
  type: string;
  data?: any;
  timestamp?: number;
  [key: string]: any;
}

export interface ExtensionResponse {
  success: boolean;
  data: any;
  error: string | null;
  timestamp: number;
}

export interface ConversationTurn {
  role: string;
  text: string;
  timestamp: string;
}

export interface EmailContext {
  threadId: string;
  emailId: string | null;
  subject: string;
  from: string;
  body?: string;
  priority?: string;
  category?: string;
  date?: string;
}

export interface ThreadMessageInput {
  from: string;
  subject: string;
  body: string;
}
