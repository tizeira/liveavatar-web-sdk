export enum MessageSender {
  USER = "user",
  AVATAR = "avatar",
}

export interface LiveAvatarSessionMessage {
  sender: MessageSender;
  message: string;
  timestamp: number;
}

/**
 * Customer data for personalization
 * Used to customize greetings and avatar responses
 */
export interface CustomerData {
  firstName?: string;
  lastName?: string;
  email?: string;
  ordersCount?: number;
  skinType?: "Dry" | "Oily" | "Combination" | "Sensitive" | "Normal";
  skinConcerns?: string[];
  recentOrders?: Array<{
    name: string;
    date: string;
    items: Array<{ title: string; quantity: number }>;
  }>;
  // Last purchase (from Liquid redirect, drives "recién compró" greeting)
  lastOrderProduct?: string;
  lastOrderDate?: string; // ISO 8601 from customer.last_order.created_at
}

/**
 * Widget state enum for state machine
 */
export enum WidgetState {
  INACTIVE = "inactive",
  CONNECTING = "connecting",
  CONNECTED = "connected",
}

/**
 * Personalization configuration
 */
export interface PersonalizationConfig {
  userName?: string | null;
  customerData?: CustomerData | null;
  greeting?: string;
  language?: string;
}
