
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "audit_log": {
                  Row: {
                    "action": string,"admin_id": string | null,"created_at": string,"details": string,"id": number,"target_id": string | null,"target_type": string
                  }
                  Insert: {
                    "action": string,"admin_id"?: string | null,"created_at"?: string,"details"?: string,"id"?: never,"target_id"?: string | null,"target_type": string
                  }
                  Update: {
                    "action"?: string,"admin_id"?: string | null,"created_at"?: string,"details"?: string,"id"?: never,"target_id"?: string | null,"target_type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_admin_id_fkey"
      columns: ["admin_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"credit_ledger": {
                  Row: {
                    "amount_cents": number,"created_at": string,"created_by": string | null,"id": number,"kind": Database["public"]['Enums']["credit_kind"],"note": string,"order_id": number | null,"user_id": string
                  }
                  Insert: {
                    "amount_cents": number,"created_at"?: string,"created_by"?: string | null,"id"?: never,"kind": Database["public"]['Enums']["credit_kind"],"note"?: string,"order_id"?: number | null,"user_id": string
                  }
                  Update: {
                    "amount_cents"?: number,"created_at"?: string,"created_by"?: string | null,"id"?: never,"kind"?: Database["public"]['Enums']["credit_kind"],"note"?: string,"order_id"?: number | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "credit_ledger_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "credit_ledger_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "credit_ledger_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"fee_email_templates": {
                  Row: {
                    "body": string,"id": number,"name": string,"subject": string,"updated_at": string
                  }
                  Insert: {
                    "body": string,"id"?: never,"name": string,"subject": string,"updated_at"?: string
                  }
                  Update: {
                    "body"?: string,"id"?: never,"name"?: string,"subject"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"legal_documents": {
                  Row: {
                    "id": string,"roles": (Database["public"]['Enums']["user_role"])[],"title": string,"version": string
                  }
                  Insert: {
                    "id": string,"roles": (Database["public"]['Enums']["user_role"])[],"title": string,"version": string
                  }
                  Update: {
                    "id"?: string,"roles"?: (Database["public"]['Enums']["user_role"])[],"title"?: string,"version"?: string
                  }
                  Relationships: [
                    
                  ]
                },"menu_items": {
                  Row: {
                    "active": boolean,"created_at": string,"description": string,"dietary": (string)[],"id": number,"image_url": string | null,"name": string,"price_cents": number,"restaurant_id": number
                  }
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"description"?: string,"dietary"?: (string)[],"id"?: number,"image_url"?: string | null,"name": string,"price_cents": number,"restaurant_id": number
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"description"?: string,"dietary"?: (string)[],"id"?: number,"image_url"?: string | null,"name"?: string,"price_cents"?: number,"restaurant_id"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "menu_items_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurant_balances"
      referencedColumns: ["restaurant_id"]
    },{
      foreignKeyName: "menu_items_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"offers": {
                  Row: {
                    "created_at": string,"description": string,"dietary": (string)[],"discount_pct": number,"id": number,"image_url": string | null,"menu_item_id": number | null,"original_price_cents": number,"pickup_end": string,"pickup_start": string,"price_cents": number | null,"quantity_available": number,"quantity_total": number,"reason": Database["public"]['Enums']["offer_reason"],"restaurant_id": number,"status": Database["public"]['Enums']["offer_status"],"title": string
                  }
                  Insert: {
                    "created_at"?: string,"description"?: string,"dietary"?: (string)[],"discount_pct": number,"id"?: number,"image_url"?: string | null,"menu_item_id"?: number | null,"original_price_cents": number,"pickup_end": string,"pickup_start"?: string,"price_cents"?: never,"quantity_available": number,"quantity_total": number,"reason": Database["public"]['Enums']["offer_reason"],"restaurant_id": number,"status"?: Database["public"]['Enums']["offer_status"],"title": string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string,"dietary"?: (string)[],"discount_pct"?: number,"id"?: number,"image_url"?: string | null,"menu_item_id"?: number | null,"original_price_cents"?: number,"pickup_end"?: string,"pickup_start"?: string,"price_cents"?: never,"quantity_available"?: number,"quantity_total"?: number,"reason"?: Database["public"]['Enums']["offer_reason"],"restaurant_id"?: number,"status"?: Database["public"]['Enums']["offer_status"],"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "offers_menu_item_id_fkey"
      columns: ["menu_item_id"]
isOneToOne: false
      referencedRelation: "menu_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "offers_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurant_balances"
      referencedColumns: ["restaurant_id"]
    },{
      foreignKeyName: "offers_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"order_pins": {
                  Row: {
                    "active": boolean,"order_id": number,"pin": string,"restaurant_id": number
                  }
                  Insert: {
                    "active"?: boolean,"order_id": number,"pin": string,"restaurant_id": number
                  }
                  Update: {
                    "active"?: boolean,"order_id"?: number,"pin"?: string,"restaurant_id"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_pins_order_id_fkey"
      columns: ["order_id"]
isOneToOne: true
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_pins_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurant_balances"
      referencedColumns: ["restaurant_id"]
    },{
      foreignKeyName: "order_pins_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"orders": {
                  Row: {
                    "capture_started_at": string | null,"card_label": string,"card_refunded_cents": number,"closed_at": string | null,"created_at": string,"credit_applied_cents": number,"credited_cents": number,"customer_username": string,"destination_account": string | null,"discount_pct": number,"id": number,"image_url": string | null,"item_title": string,"needs_void": boolean,"offer_id": number,"original_unit_price_cents": number,"payment_ref": string | null,"picked_up_at": string | null,"pickup_end": string,"quantity": number,"refund_reason": string,"refunded_at": string | null,"refunded_cents": number,"restaurant_id": number,"service_fee_bps": number,"service_fee_cents": number,"status": Database["public"]['Enums']["order_status"],"subtotal_cents": number,"tax_cents": number,"tax_rate_bps": number,"total_cents": number,"unit_price_cents": number,"user_id": string,"_pickup_json": Json | null
                  }
                  Insert: {
                    "capture_started_at"?: string | null,"card_label"?: string,"card_refunded_cents"?: number,"closed_at"?: string | null,"created_at"?: string,"credit_applied_cents"?: number,"credited_cents"?: number,"customer_username": string,"destination_account"?: string | null,"discount_pct": number,"id"?: number,"image_url"?: string | null,"item_title": string,"needs_void"?: boolean,"offer_id": number,"original_unit_price_cents": number,"payment_ref"?: string | null,"picked_up_at"?: string | null,"pickup_end": string,"quantity": number,"refund_reason"?: string,"refunded_at"?: string | null,"refunded_cents"?: number,"restaurant_id": number,"service_fee_bps": number,"service_fee_cents": number,"status"?: Database["public"]['Enums']["order_status"],"subtotal_cents": number,"tax_cents": number,"tax_rate_bps": number,"total_cents": number,"unit_price_cents": number,"user_id": string
                  }
                  Update: {
                    "capture_started_at"?: string | null,"card_label"?: string,"card_refunded_cents"?: number,"closed_at"?: string | null,"created_at"?: string,"credit_applied_cents"?: number,"credited_cents"?: number,"customer_username"?: string,"destination_account"?: string | null,"discount_pct"?: number,"id"?: number,"image_url"?: string | null,"item_title"?: string,"needs_void"?: boolean,"offer_id"?: number,"original_unit_price_cents"?: number,"payment_ref"?: string | null,"picked_up_at"?: string | null,"pickup_end"?: string,"quantity"?: number,"refund_reason"?: string,"refunded_at"?: string | null,"refunded_cents"?: number,"restaurant_id"?: number,"service_fee_bps"?: number,"service_fee_cents"?: number,"status"?: Database["public"]['Enums']["order_status"],"subtotal_cents"?: number,"tax_cents"?: number,"tax_rate_bps"?: number,"total_cents"?: number,"unit_price_cents"?: number,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "orders_offer_id_fkey"
      columns: ["offer_id"]
isOneToOne: false
      referencedRelation: "offers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurant_balances"
      referencedColumns: ["restaurant_id"]
    },{
      foreignKeyName: "orders_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"payment_methods": {
                  Row: {
                    "brand": string,"created_at": string,"exp_month": number,"exp_year": number,"id": number,"is_default": boolean,"last4": string,"provider_ref": string,"user_id": string
                  }
                  Insert: {
                    "brand": string,"created_at"?: string,"exp_month": number,"exp_year": number,"id"?: number,"is_default"?: boolean,"last4": string,"provider_ref": string,"user_id": string
                  }
                  Update: {
                    "brand"?: string,"created_at"?: string,"exp_month"?: number,"exp_year"?: number,"id"?: number,"is_default"?: boolean,"last4"?: string,"provider_ref"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_methods_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"payouts": {
                  Row: {
                    "amount_cents": number,"bank_details": string,"created_by": string | null,"id": number,"invoice_number": string | null,"kind": Database["public"]['Enums']["payout_kind"],"note": string,"order_id": number | null,"paid_at": string,"restaurant_id": number,"transaction_id": string
                  }
                  Insert: {
                    "amount_cents": number,"bank_details"?: string,"created_by"?: string | null,"id"?: number,"invoice_number"?: string | null,"kind": Database["public"]['Enums']["payout_kind"],"note"?: string,"order_id"?: number | null,"paid_at"?: string,"restaurant_id": number,"transaction_id"?: string
                  }
                  Update: {
                    "amount_cents"?: number,"bank_details"?: string,"created_by"?: string | null,"id"?: number,"invoice_number"?: string | null,"kind"?: Database["public"]['Enums']["payout_kind"],"note"?: string,"order_id"?: number | null,"paid_at"?: string,"restaurant_id"?: number,"transaction_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payouts_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payouts_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payouts_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurant_balances"
      referencedColumns: ["restaurant_id"]
    },{
      foreignKeyName: "payouts_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"pin_failures": {
                  Row: {
                    "at": string,"id": number,"restaurant_id": number
                  }
                  Insert: {
                    "at"?: string,"id"?: never,"restaurant_id": number
                  }
                  Update: {
                    "at"?: string,"id"?: never,"restaurant_id"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "pin_failures_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurant_balances"
      referencedColumns: ["restaurant_id"]
    },{
      foreignKeyName: "pin_failures_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"email": string,"id": string,"role": Database["public"]['Enums']["user_role"],"status": Database["public"]['Enums']["account_status"],"stripe_customer_id": string | null,"suspended_until": string | null,"username": string
                  }
                  Insert: {
                    "created_at"?: string,"email": string,"id": string,"role"?: Database["public"]['Enums']["user_role"],"status"?: Database["public"]['Enums']["account_status"],"stripe_customer_id"?: string | null,"suspended_until"?: string | null,"username": string
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"id"?: string,"role"?: Database["public"]['Enums']["user_role"],"status"?: Database["public"]['Enums']["account_status"],"stripe_customer_id"?: string | null,"suspended_until"?: string | null,"username"?: string
                  }
                  Relationships: [
                    
                  ]
                },"refunds": {
                  Row: {
                    "amount_cents": number,"card_cents": number,"created_at": string,"created_by": string | null,"credit_cents": number,"id": number,"method": Database["public"]['Enums']["refund_method"],"order_id": number,"provider_ref": string | null,"reason": string,"restaurant_share_cents": number
                  }
                  Insert: {
                    "amount_cents": number,"card_cents"?: number,"created_at"?: string,"created_by"?: string | null,"credit_cents"?: number,"id"?: never,"method": Database["public"]['Enums']["refund_method"],"order_id": number,"provider_ref"?: string | null,"reason": string,"restaurant_share_cents"?: number
                  }
                  Update: {
                    "amount_cents"?: number,"card_cents"?: number,"created_at"?: string,"created_by"?: string | null,"credit_cents"?: number,"id"?: never,"method"?: Database["public"]['Enums']["refund_method"],"order_id"?: number,"provider_ref"?: string | null,"reason"?: string,"restaurant_share_cents"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "refunds_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "refunds_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    }
                  ]
                },"restaurant_kiosks": {
                  Row: {
                    "created_at": string,"restaurant_id": number,"token": string
                  }
                  Insert: {
                    "created_at"?: string,"restaurant_id": number,"token": string
                  }
                  Update: {
                    "created_at"?: string,"restaurant_id"?: number,"token"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "restaurant_kiosks_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: true
      referencedRelation: "restaurant_balances"
      referencedColumns: ["restaurant_id"]
    },{
      foreignKeyName: "restaurant_kiosks_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: true
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"restaurant_onboarding": {
                  Row: {
                    "pending_email_sent_at": string | null,"restaurant_id": number,"welcome_email_sent_at": string | null
                  }
                  Insert: {
                    "pending_email_sent_at"?: string | null,"restaurant_id": number,"welcome_email_sent_at"?: string | null
                  }
                  Update: {
                    "pending_email_sent_at"?: string | null,"restaurant_id"?: number,"welcome_email_sent_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "restaurant_onboarding_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: true
      referencedRelation: "restaurant_balances"
      referencedColumns: ["restaurant_id"]
    },{
      foreignKeyName: "restaurant_onboarding_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: true
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"restaurant_payment_accounts": {
                  Row: {
                    "bank_summary": string,"charges_enabled": boolean,"details_submitted": boolean,"payouts_enabled": boolean,"restaurant_id": number,"stripe_account_id": string | null,"updated_at": string
                  }
                  Insert: {
                    "bank_summary"?: string,"charges_enabled"?: boolean,"details_submitted"?: boolean,"payouts_enabled"?: boolean,"restaurant_id": number,"stripe_account_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "bank_summary"?: string,"charges_enabled"?: boolean,"details_submitted"?: boolean,"payouts_enabled"?: boolean,"restaurant_id"?: number,"stripe_account_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "restaurant_payment_accounts_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: true
      referencedRelation: "restaurant_balances"
      referencedColumns: ["restaurant_id"]
    },{
      foreignKeyName: "restaurant_payment_accounts_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: true
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"restaurant_subscriptions": {
                  Row: {
                    "auto_renew": boolean,"card_label": string,"card_ref": string | null,"created_at": string,"current_period_end": string | null,"current_period_start": string | null,"customer_ref": string | null,"founding_number": number | null,"last_payment_error": string,"locked_annual_cents": number | null,"locked_monthly_cents": number | null,"plan": Database["public"]['Enums']["subscription_plan"],"price_cents": number,"reminder_sent_for": string | null,"renew_plan": Database["public"]['Enums']["subscription_plan"] | null,"renewing_at": string | null,"restaurant_id": number,"retry_at": string | null,"status": Database["public"]['Enums']["subscription_status"],"updated_at": string
                  }
                  Insert: {
                    "auto_renew"?: boolean,"card_label"?: string,"card_ref"?: string | null,"created_at"?: string,"current_period_end"?: string | null,"current_period_start"?: string | null,"customer_ref"?: string | null,"founding_number"?: number | null,"last_payment_error"?: string,"locked_annual_cents"?: number | null,"locked_monthly_cents"?: number | null,"plan": Database["public"]['Enums']["subscription_plan"],"price_cents"?: number,"reminder_sent_for"?: string | null,"renew_plan"?: Database["public"]['Enums']["subscription_plan"] | null,"renewing_at"?: string | null,"restaurant_id": number,"retry_at"?: string | null,"status"?: Database["public"]['Enums']["subscription_status"],"updated_at"?: string
                  }
                  Update: {
                    "auto_renew"?: boolean,"card_label"?: string,"card_ref"?: string | null,"created_at"?: string,"current_period_end"?: string | null,"current_period_start"?: string | null,"customer_ref"?: string | null,"founding_number"?: number | null,"last_payment_error"?: string,"locked_annual_cents"?: number | null,"locked_monthly_cents"?: number | null,"plan"?: Database["public"]['Enums']["subscription_plan"],"price_cents"?: number,"reminder_sent_for"?: string | null,"renew_plan"?: Database["public"]['Enums']["subscription_plan"] | null,"renewing_at"?: string | null,"restaurant_id"?: number,"retry_at"?: string | null,"status"?: Database["public"]['Enums']["subscription_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "restaurant_subscriptions_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: true
      referencedRelation: "restaurant_balances"
      referencedColumns: ["restaurant_id"]
    },{
      foreignKeyName: "restaurant_subscriptions_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: true
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"restaurants": {
                  Row: {
                    "address": string,"admin_note": string,"city": string,"created_at": string,"cuisine": string,"description": string,"id": number,"lat": number | null,"lng": number | null,"location": unknown,"name": string,"owner_id": string,"phone": string,"status": Database["public"]['Enums']["restaurant_status"],"suspended_until": string | null,"tax_rate_bps": number,"zip": string
                  }
                  Insert: {
                    "address": string,"admin_note"?: string,"city": string,"created_at"?: string,"cuisine"?: string,"description"?: string,"id"?: number,"lat"?: never,"lng"?: never,"location"?: unknown,"name": string,"owner_id": string,"phone"?: string,"status"?: Database["public"]['Enums']["restaurant_status"],"suspended_until"?: string | null,"tax_rate_bps": number,"zip": string
                  }
                  Update: {
                    "address"?: string,"admin_note"?: string,"city"?: string,"created_at"?: string,"cuisine"?: string,"description"?: string,"id"?: number,"lat"?: never,"lng"?: never,"location"?: unknown,"name"?: string,"owner_id"?: string,"phone"?: string,"status"?: Database["public"]['Enums']["restaurant_status"],"suspended_until"?: string | null,"tax_rate_bps"?: number,"zip"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "restaurants_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"settings": {
                  Row: {
                    "key": string,"updated_at": string,"value": NonNullable<Json>
                  }
                  Insert: {
                    "key": string,"updated_at"?: string,"value": NonNullable<Json>
                  }
                  Update: {
                    "key"?: string,"updated_at"?: string,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"subscription_payments": {
                  Row: {
                    "amount_cents": number,"card_label": string,"created_at": string,"error": string,"id": number,"invoice_number": string | null,"period_end": string | null,"period_start": string | null,"plan": Database["public"]['Enums']["subscription_plan"],"restaurant_id": number,"status": string,"transaction_id": string
                  }
                  Insert: {
                    "amount_cents": number,"card_label"?: string,"created_at"?: string,"error"?: string,"id"?: number,"invoice_number"?: string | null,"period_end"?: string | null,"period_start"?: string | null,"plan": Database["public"]['Enums']["subscription_plan"],"restaurant_id": number,"status": string,"transaction_id"?: string
                  }
                  Update: {
                    "amount_cents"?: number,"card_label"?: string,"created_at"?: string,"error"?: string,"id"?: number,"invoice_number"?: string | null,"period_end"?: string | null,"period_start"?: string | null,"plan"?: Database["public"]['Enums']["subscription_plan"],"restaurant_id"?: number,"status"?: string,"transaction_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "subscription_payments_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurant_balances"
      referencedColumns: ["restaurant_id"]
    },{
      foreignKeyName: "subscription_payments_restaurant_id_fkey"
      columns: ["restaurant_id"]
isOneToOne: false
      referencedRelation: "restaurants"
      referencedColumns: ["id"]
    }
                  ]
                },"subscription_price_changes": {
                  Row: {
                    "annual_cents": number,"applied_at": string | null,"applies_to_existing": boolean,"body": string,"cancelled_at": string | null,"created_at": string,"created_by": string | null,"effective_at": string,"emails_failed": number,"emails_sent": number,"id": number,"include_founding": boolean,"monthly_cents": number,"previous_annual_cents": number,"previous_monthly_cents": number,"subject": string,"template_name": string
                  }
                  Insert: {
                    "annual_cents": number,"applied_at"?: string | null,"applies_to_existing": boolean,"body": string,"cancelled_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"effective_at": string,"emails_failed"?: number,"emails_sent"?: number,"id"?: never,"include_founding"?: boolean,"monthly_cents": number,"previous_annual_cents": number,"previous_monthly_cents": number,"subject": string,"template_name"?: string
                  }
                  Update: {
                    "annual_cents"?: number,"applied_at"?: string | null,"applies_to_existing"?: boolean,"body"?: string,"cancelled_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"effective_at"?: string,"emails_failed"?: number,"emails_sent"?: number,"id"?: never,"include_founding"?: boolean,"monthly_cents"?: number,"previous_annual_cents"?: number,"previous_monthly_cents"?: number,"subject"?: string,"template_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "subscription_price_changes_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"terms_acceptances": {
                  Row: {
                    "accepted_at": string,"document": string,"id": number,"ip": string,"user_agent": string,"user_id": string,"version": string
                  }
                  Insert: {
                    "accepted_at"?: string,"document": string,"id"?: never,"ip"?: string,"user_agent"?: string,"user_id": string,"version": string
                  }
                  Update: {
                    "accepted_at"?: string,"document"?: string,"id"?: never,"ip"?: string,"user_agent"?: string,"user_id"?: string,"version"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "terms_acceptances_document_fkey"
      columns: ["document"]
isOneToOne: false
      referencedRelation: "legal_documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "terms_acceptances_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"zips": {
                  Row: {
                    "cities": (string)[],"city": string,"county": string,"location": unknown,"zip": string
                  }
                  Insert: {
                    "cities": (string)[],"city": string,"county": string,"location": unknown,"zip": string
                  }
                  Update: {
                    "cities"?: (string)[],"city"?: string,"county"?: string,"location"?: unknown,"zip"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            "restaurant_balances": {
                  Row: {
                    "balance_cents": number | null,"city": string | null,"earned_cents": number | null,"last_paid_at": string | null,"name": string | null,"orders": number | null,"paid_cents": number | null,"restaurant_id": number | null,"status": Database["public"]['Enums']["restaurant_status"] | null
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "_orderable_offer":
{ Args: { "p_lock": boolean,"p_offer_id": number,"p_quantity": number }; Returns: {
              "created_at": string,
"description": string,
"dietary": (string)[],
"discount_pct": number,
"id": number,
"image_url": string | null,
"menu_item_id": number | null,
"original_price_cents": number,
"pickup_end": string,
"pickup_start": string,
"price_cents": number | null,
"quantity_available": number,
"quantity_total": number,
"reason": Database["public"]['Enums']["offer_reason"],
"restaurant_id": number,
"status": Database["public"]['Enums']["offer_status"],
"title": string
            }
                          SetofOptions: {
        from: "*"
        to: "offers"
        isOneToOne: true
        isSetofReturn: false
      } },
"_pickup_json":
{ Args: { "o": Database["public"]['Tables']["orders"]['Row'] }; Returns: Json
                           },
"_random_pin":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"_restaurant_posting_block":
{ Args: { "rid": number }; Returns: string
                           },
"abort_pickup":
{ Args: { "p_order_id": number }; Returns: undefined
                           },
"accept_terms":
{ Args: { "p_accepted": Json,"p_ip"?: string,"p_user_agent"?: string }; Returns: undefined
                           },
"apply_refund":
{ Args: { "p_amount_cents": number,"p_by": string,"p_card_cents": number,"p_credit_cents": number,"p_method": Database["public"]['Enums']["refund_method"],"p_order_id": number,"p_provider_ref": string,"p_reason": string,"p_restaurant_share_cents": number }; Returns: {
              "capture_started_at": string | null,
"card_label": string,
"card_refunded_cents": number,
"closed_at": string | null,
"created_at": string,
"credit_applied_cents": number,
"credited_cents": number,
"customer_username": string,
"destination_account": string | null,
"discount_pct": number,
"id": number,
"image_url": string | null,
"item_title": string,
"needs_void": boolean,
"offer_id": number,
"original_unit_price_cents": number,
"payment_ref": string | null,
"picked_up_at": string | null,
"pickup_end": string,
"quantity": number,
"refund_reason": string,
"refunded_at": string | null,
"refunded_cents": number,
"restaurant_id": number,
"service_fee_bps": number,
"service_fee_cents": number,
"status": Database["public"]['Enums']["order_status"],
"subtotal_cents": number,
"tax_cents": number,
"tax_rate_bps": number,
"total_cents": number,
"unit_price_cents": number,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "orders"
        isOneToOne: true
        isSetofReturn: false
      } },
"begin_pickup_for":
{ Args: { "p_order_id": number,"p_pin": string,"p_restaurant_id": number }; Returns: Json
                           },
"claim_founding_spot":
{ Args: { "p_restaurant_id": number }; Returns: number
                           },
"clear_void":
{ Args: { "p_order_id": number }; Returns: undefined
                           },
"credit_balance":
{ Args: { "p_user": string }; Returns: number
                           },
"find_pickup_for":
{ Args: { "p_pin": string,"p_restaurant_id": number }; Returns: Json
                           },
"finish_pickup":
{ Args: { "p_order_id": number }; Returns: {
              "capture_started_at": string | null,
"card_label": string,
"card_refunded_cents": number,
"closed_at": string | null,
"created_at": string,
"credit_applied_cents": number,
"credited_cents": number,
"customer_username": string,
"destination_account": string | null,
"discount_pct": number,
"id": number,
"image_url": string | null,
"item_title": string,
"needs_void": boolean,
"offer_id": number,
"original_unit_price_cents": number,
"payment_ref": string | null,
"picked_up_at": string | null,
"pickup_end": string,
"quantity": number,
"refund_reason": string,
"refunded_at": string | null,
"refunded_cents": number,
"restaurant_id": number,
"service_fee_bps": number,
"service_fee_cents": number,
"status": Database["public"]['Enums']["order_status"],
"subtotal_cents": number,
"tax_cents": number,
"tax_rate_bps": number,
"total_cents": number,
"unit_price_cents": number,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "orders"
        isOneToOne: true
        isSetofReturn: false
      } },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"issue_credit":
{ Args: { "p_amount_cents": number,"p_by": string,"p_note": string,"p_user": string }; Returns: number
                           },
"mark_order_reserved":
{ Args: { "p_order_id": number }; Returns: boolean
                           },
"my_cancel_order":
{ Args: { "p_order_id": number }; Returns: Json
                           },
"my_credit_balance":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"my_restaurant_id":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"next_subscription_invoice":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"pending_terms":
{ Args: Record<PropertyKey, never>; Returns: {
              "id": string,
"roles": (Database["public"]['Enums']["user_role"])[],
"title": string,
"version": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "legal_documents"
        isOneToOne: false
        isSetofReturn: true
      } },
"price_quote":
{ Args: { "p_discount_pct": number,"p_original_unit_cents": number,"p_quantity": number,"p_tax_rate_bps": number }; Returns: Json
                           },
"quote_offer":
{ Args: { "p_offer_id": number,"p_quantity": number }; Returns: Json
                           },
"record_payout":
{ Args: { "p_amount_cents": number,"p_bank_details": string,"p_by": string,"p_kind": Database["public"]['Enums']["payout_kind"],"p_note": string,"p_order_id": number,"p_restaurant_id": number,"p_transaction_id": string }; Returns: {
              "amount_cents": number,
"bank_details": string,
"created_by": string | null,
"id": number,
"invoice_number": string | null,
"kind": Database["public"]['Enums']["payout_kind"],
"note": string,
"order_id": number | null,
"paid_at": string,
"restaurant_id": number,
"transaction_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "payouts"
        isOneToOne: true
        isSetofReturn: false
      } },
"release_order":
{ Args: { "p_from": Database["public"]['Enums']["order_status"],"p_order_id": number,"p_restock": boolean,"p_to": Database["public"]['Enums']["order_status"] }; Returns: Json
                           },
"reserve_order":
{ Args: { "p_card_label": string,"p_credit_cents"?: number,"p_offer_id": number,"p_quantity": number,"p_user": string }; Returns: {
              "capture_started_at": string | null,
"card_label": string,
"card_refunded_cents": number,
"closed_at": string | null,
"created_at": string,
"credit_applied_cents": number,
"credited_cents": number,
"customer_username": string,
"destination_account": string | null,
"discount_pct": number,
"id": number,
"image_url": string | null,
"item_title": string,
"needs_void": boolean,
"offer_id": number,
"original_unit_price_cents": number,
"payment_ref": string | null,
"picked_up_at": string | null,
"pickup_end": string,
"quantity": number,
"refund_reason": string,
"refunded_at": string | null,
"refunded_cents": number,
"restaurant_id": number,
"service_fee_bps": number,
"service_fee_cents": number,
"status": Database["public"]['Enums']["order_status"],
"subtotal_cents": number,
"tax_cents": number,
"tax_rate_bps": number,
"total_cents": number,
"unit_price_cents": number,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "orders"
        isOneToOne: true
        isSetofReturn: false
      } },
"resolve_area":
{ Args: { "p_query": string }; Returns: {
              "kind": string,"label": string,"lat": number,"lng": number
            }[]
                           },
"restaurant_begin_pickup":
{ Args: { "p_order_id": number,"p_pin": string }; Returns: Json
                           },
"restaurant_extend_offer":
{ Args: { "p_minutes": number,"p_offer_id": number }; Returns: {
              "created_at": string,
"description": string,
"dietary": (string)[],
"discount_pct": number,
"id": number,
"image_url": string | null,
"menu_item_id": number | null,
"original_price_cents": number,
"pickup_end": string,
"pickup_start": string,
"price_cents": number | null,
"quantity_available": number,
"quantity_total": number,
"reason": Database["public"]['Enums']["offer_reason"],
"restaurant_id": number,
"status": Database["public"]['Enums']["offer_status"],
"title": string
            }
                          SetofOptions: {
        from: "*"
        to: "offers"
        isOneToOne: true
        isSetofReturn: false
      } },
"restaurant_find_pickup":
{ Args: { "p_pin": string }; Returns: Json
                           },
"restaurant_plan_ok":
{ Args: { "p_restaurant_id": number }; Returns: boolean
                           },
"restaurant_save_offer":
{ Args: { "p_description": string,"p_discount_pct": number,"p_expires_in_minutes": number,"p_menu_item_id": number,"p_offer_id": number,"p_quantity": number,"p_reason": Database["public"]['Enums']["offer_reason"] }; Returns: {
              "created_at": string,
"description": string,
"dietary": (string)[],
"discount_pct": number,
"id": number,
"image_url": string | null,
"menu_item_id": number | null,
"original_price_cents": number,
"pickup_end": string,
"pickup_start": string,
"price_cents": number | null,
"quantity_available": number,
"quantity_total": number,
"reason": Database["public"]['Enums']["offer_reason"],
"restaurant_id": number,
"status": Database["public"]['Enums']["offer_status"],
"title": string
            }
                          SetofOptions: {
        from: "*"
        to: "offers"
        isOneToOne: true
        isSetofReturn: false
      } },
"restaurant_set_offer_status":
{ Args: { "p_offer_id": number,"p_status": Database["public"]['Enums']["offer_status"] }; Returns: {
              "created_at": string,
"description": string,
"dietary": (string)[],
"discount_pct": number,
"id": number,
"image_url": string | null,
"menu_item_id": number | null,
"original_price_cents": number,
"pickup_end": string,
"pickup_start": string,
"price_cents": number | null,
"quantity_available": number,
"quantity_total": number,
"reason": Database["public"]['Enums']["offer_reason"],
"restaurant_id": number,
"status": Database["public"]['Enums']["offer_status"],
"title": string
            }
                          SetofOptions: {
        from: "*"
        to: "offers"
        isOneToOne: true
        isSetofReturn: false
      } },
"restaurant_stats":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"search_offers":
{ Args: { "p_area_text"?: string,"p_dietary"?: string,"p_lat"?: number,"p_lng"?: number,"p_query"?: string,"p_radius_miles"?: number,"p_sort"?: string }; Returns: {
              "address": string,"city": string,"cuisine": string,"description": string,"dietary": (string)[],"discount_pct": number,"distance_miles": number,"id": number,"image_url": string,"lat": number,"lng": number,"original_price_cents": number,"phone": string,"pickup_end": string,"pickup_start": string,"price_cents": number,"quantity_available": number,"quantity_total": number,"reason": Database["public"]['Enums']["offer_reason"],"restaurant_id": number,"restaurant_name": string,"tax_rate_bps": number,"title": string,"zip": string
            }[]
                           },
"set_order_payment":
{ Args: { "p_destination": string,"p_order_id": number,"p_payment_ref": string }; Returns: undefined
                           },
"setting_bool":
{ Args: { "p_key": string }; Returns: boolean
                           },
"setting_int":
{ Args: { "p_key": string }; Returns: number
                           },
"sweep":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"zip_location":
{ Args: { "p_zip": string }; Returns: unknown
                           }
          }
          Enums: {
            "account_status": "active"|"suspended"|"deleted"|"banned","credit_kind": "refund"|"goodwill"|"redeem"|"restore"|"adjustment","offer_reason": "wrong_order"|"delayed_order"|"unclaimed_order"|"overproduction"|"end_of_day"|"other","offer_status": "active"|"paused"|"ended","order_status": "pending_payment"|"reserved"|"picked_up"|"cancelled"|"expired"|"failed","payout_kind": "transfer"|"reversal"|"manual","refund_method": "original"|"credit","restaurant_status": "pending"|"approved"|"suspended"|"banned"|"deleted","subscription_plan": "founding"|"monthly"|"annual","subscription_status": "active"|"past_due"|"expired","user_role": "customer"|"restaurant"|"admin"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "account_status": ["active", "suspended", "deleted", "banned"],"credit_kind": ["refund", "goodwill", "redeem", "restore", "adjustment"],"offer_reason": ["wrong_order", "delayed_order", "unclaimed_order", "overproduction", "end_of_day", "other"],"offer_status": ["active", "paused", "ended"],"order_status": ["pending_payment", "reserved", "picked_up", "cancelled", "expired", "failed"],"payout_kind": ["transfer", "reversal", "manual"],"refund_method": ["original", "credit"],"restaurant_status": ["pending", "approved", "suspended", "banned", "deleted"],"subscription_plan": ["founding", "monthly", "annual"],"subscription_status": ["active", "past_due", "expired"],"user_role": ["customer", "restaurant", "admin"]
          }
        }
} as const

