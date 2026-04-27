export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      admin_audit_logs: {
        Row: {
          action: string
          admin_id: string
          created_at: string
          id: string
          ip_address: unknown
          metadata: Json | null
          new_data: Json | null
          old_data: Json | null
          target_id: string
          target_type: string
          user_agent: string | null
        }
        Insert: {
          action: string
          admin_id: string
          created_at?: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          new_data?: Json | null
          old_data?: Json | null
          target_id: string
          target_type: string
          user_agent?: string | null
        }
        Update: {
          action?: string
          admin_id?: string
          created_at?: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          new_data?: Json | null
          old_data?: Json | null
          target_id?: string
          target_type?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      archived_messages: {
        Row: {
          archived_at: string
          content: string
          conversation_id: string
          id: string
          idempotency_key: string | null
          read_at: string | null
          sender_id: string
          sent_at: string
        }
        Insert: {
          archived_at?: string
          content: string
          conversation_id: string
          id: string
          idempotency_key?: string | null
          read_at?: string | null
          sender_id: string
          sent_at: string
        }
        Update: {
          archived_at?: string
          content?: string
          conversation_id?: string
          id?: string
          idempotency_key?: string | null
          read_at?: string | null
          sender_id?: string
          sent_at?: string
        }
        Relationships: []
      }
      brand_ambassadors: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          player_id: string
          responded_at: string | null
          status: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          player_id: string
          responded_at?: string | null
          status?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          player_id?: string
          responded_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_ambassadors_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_ambassadors_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_ambassadors_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_followers: {
        Row: {
          brand_id: string
          created_at: string
          follower_id: string
          id: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          follower_id: string
          id?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          follower_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_followers_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_followers_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_followers_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_posts: {
        Row: {
          brand_id: string
          content: string
          created_at: string
          deleted_at: string | null
          id: string
          image_url: string | null
          updated_at: string
        }
        Insert: {
          brand_id: string
          content: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          image_url?: string | null
          updated_at?: string
        }
        Update: {
          brand_id?: string
          content?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          image_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_posts_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_products: {
        Row: {
          brand_id: string
          created_at: string | null
          deleted_at: string | null
          description: string | null
          external_url: string | null
          id: string
          images: Json | null
          name: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          brand_id: string
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          external_url?: string | null
          id?: string
          images?: Json | null
          name: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          brand_id?: string
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          external_url?: string | null
          id?: string
          images?: Json | null
          name?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          ambassador_count: number
          bio: string | null
          category: string
          created_at: string | null
          deleted_at: string | null
          follower_count: number
          id: string
          instagram_url: string | null
          logo_url: string | null
          name: string
          profile_id: string
          search_vector: unknown
          slug: string
          updated_at: string | null
          website_url: string | null
        }
        Insert: {
          ambassador_count?: number
          bio?: string | null
          category?: string
          created_at?: string | null
          deleted_at?: string | null
          follower_count?: number
          id?: string
          instagram_url?: string | null
          logo_url?: string | null
          name: string
          profile_id: string
          search_vector?: unknown
          slug: string
          updated_at?: string | null
          website_url?: string | null
        }
        Update: {
          ambassador_count?: number
          bio?: string | null
          category?: string
          created_at?: string | null
          deleted_at?: string | null
          follower_count?: number
          id?: string
          instagram_url?: string | null
          logo_url?: string | null
          name?: string
          profile_id?: string
          search_vector?: unknown
          slug?: string
          updated_at?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brands_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brands_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      career_history: {
        Row: {
          badge_label: string | null
          club_name: string
          created_at: string
          description: string | null
          display_order: number
          division_league: string
          end_date: string | null
          entry_type: Database["public"]["Enums"]["journey_entry_type"]
          highlights: string[]
          id: string
          image_url: string | null
          location_city: string | null
          location_country: string | null
          position_role: string
          start_date: string | null
          updated_at: string
          user_id: string
          world_club_id: string | null
          years: string
        }
        Insert: {
          badge_label?: string | null
          club_name: string
          created_at?: string
          description?: string | null
          display_order?: number
          division_league: string
          end_date?: string | null
          entry_type?: Database["public"]["Enums"]["journey_entry_type"]
          highlights?: string[]
          id?: string
          image_url?: string | null
          location_city?: string | null
          location_country?: string | null
          position_role: string
          start_date?: string | null
          updated_at?: string
          user_id: string
          world_club_id?: string | null
          years: string
        }
        Update: {
          badge_label?: string | null
          club_name?: string
          created_at?: string
          description?: string | null
          display_order?: number
          division_league?: string
          end_date?: string | null
          entry_type?: Database["public"]["Enums"]["journey_entry_type"]
          highlights?: string[]
          id?: string
          image_url?: string | null
          location_city?: string | null
          location_country?: string | null
          position_role?: string
          start_date?: string | null
          updated_at?: string
          user_id?: string
          world_club_id?: string | null
          years?: string
        }
        Relationships: [
          {
            foreignKeyName: "career_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "career_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "career_history_world_club_id_fkey"
            columns: ["world_club_id"]
            isOneToOne: false
            referencedRelation: "world_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      club_media: {
        Row: {
          alt_text: string | null
          caption: string | null
          club_id: string
          created_at: string
          file_name: string
          file_size: number
          file_url: string
          id: string
          is_featured: boolean
          order_index: number
          updated_at: string
        }
        Insert: {
          alt_text?: string | null
          caption?: string | null
          club_id: string
          created_at?: string
          file_name: string
          file_size: number
          file_url: string
          id?: string
          is_featured?: boolean
          order_index?: number
          updated_at?: string
        }
        Update: {
          alt_text?: string | null
          caption?: string | null
          club_id?: string
          created_at?: string
          file_name?: string
          file_size?: number
          file_url?: string
          id?: string
          is_featured?: boolean
          order_index?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_media_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_media_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      community_answers: {
        Row: {
          author_id: string
          body: string
          created_at: string
          deleted_at: string | null
          id: string
          is_test_content: boolean
          question_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_test_content?: boolean
          question_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_test_content?: boolean
          question_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_answers_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_answers_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "community_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      community_questions: {
        Row: {
          answer_count: number
          author_id: string
          body: string | null
          category: Database["public"]["Enums"]["question_category"]
          created_at: string
          deleted_at: string | null
          id: string
          is_test_content: boolean
          title: string
          updated_at: string
        }
        Insert: {
          answer_count?: number
          author_id: string
          body?: string | null
          category?: Database["public"]["Enums"]["question_category"]
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_test_content?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          answer_count?: number
          author_id?: string
          body?: string | null
          category?: Database["public"]["Enums"]["question_category"]
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_test_content?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_questions_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_questions_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          last_message_at: string | null
          participant_one_id: string
          participant_two_id: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          participant_one_id: string
          participant_two_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          participant_one_id?: string
          participant_two_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversations_participant_one_id_fkey"
            columns: ["participant_one_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_participant_one_id_fkey"
            columns: ["participant_one_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_participant_two_id_fkey"
            columns: ["participant_two_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_participant_two_id_fkey"
            columns: ["participant_two_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      countries: {
        Row: {
          code: string
          code_alpha3: string
          common_name: string | null
          created_at: string
          flag_emoji: string | null
          id: number
          name: string
          nationality_name: string
          region: string | null
        }
        Insert: {
          code: string
          code_alpha3: string
          common_name?: string | null
          created_at?: string
          flag_emoji?: string | null
          id?: number
          name: string
          nationality_name: string
          region?: string | null
        }
        Update: {
          code?: string
          code_alpha3?: string
          common_name?: string | null
          created_at?: string
          flag_emoji?: string | null
          id?: number
          name?: string
          nationality_name?: string
          region?: string | null
        }
        Relationships: []
      }
      country_text_aliases: {
        Row: {
          alias_text: string
          confidence: string
          country_id: number
          created_at: string
          id: number
        }
        Insert: {
          alias_text: string
          confidence?: string
          country_id: number
          created_at?: string
          id?: number
        }
        Update: {
          alias_text?: string
          confidence?: string
          country_id?: number
          created_at?: string
          id?: number
        }
        Relationships: [
          {
            foreignKeyName: "country_text_aliases_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "country_text_aliases_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "world_countries_with_directory"
            referencedColumns: ["country_id"]
          },
        ]
      }
      discovery_events: {
        Row: {
          created_at: string
          error_message: string | null
          has_qualitative: boolean | null
          id: string
          intent: string
          llm_provider: string | null
          parsed_filters: Json | null
          query_text: string
          response_time_ms: number | null
          result_count: number
          role: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          has_qualitative?: boolean | null
          id?: string
          intent: string
          llm_provider?: string | null
          parsed_filters?: Json | null
          query_text: string
          response_time_ms?: number | null
          result_count?: number
          role?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          has_qualitative?: boolean | null
          id?: string
          intent?: string
          llm_provider?: string | null
          parsed_filters?: Json | null
          query_text?: string
          response_time_ms?: number | null
          result_count?: number
          role?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "discovery_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discovery_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaigns: {
        Row: {
          ab_variants: Json | null
          audience_filter: Json | null
          audience_source: string
          category: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          scheduled_at: string | null
          sent_at: string | null
          status: string
          target_country: string | null
          target_role: string | null
          template_id: string | null
          template_key: string | null
          total_recipients: number
          updated_at: string
        }
        Insert: {
          ab_variants?: Json | null
          audience_filter?: Json | null
          audience_source?: string
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string
          target_country?: string | null
          target_role?: string | null
          template_id?: string | null
          template_key?: string | null
          total_recipients?: number
          updated_at?: string
        }
        Update: {
          ab_variants?: Json | null
          audience_filter?: Json | null
          audience_source?: string
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string
          target_country?: string | null
          target_role?: string | null
          template_id?: string | null
          template_key?: string | null
          total_recipients?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_campaigns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_template_stats"
            referencedColumns: ["template_id"]
          },
          {
            foreignKeyName: "email_campaigns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      email_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          metadata: Json | null
          occurred_at: string
          raw_payload: Json
          resend_email_id: string
          send_id: string | null
          url: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json | null
          occurred_at: string
          raw_payload?: Json
          resend_email_id: string
          send_id?: string | null
          url?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          occurred_at?: string
          raw_payload?: Json
          resend_email_id?: string
          send_id?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_events_send_id_fkey"
            columns: ["send_id"]
            isOneToOne: false
            referencedRelation: "email_sends"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sends: {
        Row: {
          bounced_at: string | null
          campaign_id: string | null
          clicked_at: string | null
          created_at: string
          delivered_at: string | null
          id: string
          metadata: Json | null
          opened_at: string | null
          recipient_country: string | null
          recipient_email: string
          recipient_id: string | null
          recipient_role: string | null
          resend_email_id: string | null
          sent_at: string
          status: string
          subject: string
          template_key: string
          variant: string | null
        }
        Insert: {
          bounced_at?: string | null
          campaign_id?: string | null
          clicked_at?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          metadata?: Json | null
          opened_at?: string | null
          recipient_country?: string | null
          recipient_email: string
          recipient_id?: string | null
          recipient_role?: string | null
          resend_email_id?: string | null
          sent_at?: string
          status?: string
          subject: string
          template_key: string
          variant?: string | null
        }
        Update: {
          bounced_at?: string | null
          campaign_id?: string | null
          clicked_at?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          metadata?: Json | null
          opened_at?: string | null
          recipient_country?: string | null
          recipient_email?: string
          recipient_id?: string | null
          recipient_role?: string | null
          resend_email_id?: string | null
          sent_at?: string
          status?: string
          subject?: string
          template_key?: string
          variant?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_sends_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sends_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sends_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      email_template_versions: {
        Row: {
          change_note: string | null
          content_json: Json
          created_at: string
          created_by: string | null
          id: string
          subject_template: string
          template_id: string
          text_template: string | null
          variables: Json
          version_number: number
        }
        Insert: {
          change_note?: string | null
          content_json?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          subject_template: string
          template_id: string
          text_template?: string | null
          variables?: Json
          version_number: number
        }
        Update: {
          change_note?: string | null
          content_json?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          subject_template?: string
          template_id?: string
          text_template?: string | null
          variables?: Json
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "email_template_versions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_template_stats"
            referencedColumns: ["template_id"]
          },
          {
            foreignKeyName: "email_template_versions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          category: string
          content_json: Json
          created_at: string
          current_version: number
          description: string | null
          id: string
          is_active: boolean
          name: string
          subject_template: string
          template_key: string
          text_template: string | null
          updated_at: string
          variables: Json
        }
        Insert: {
          category?: string
          content_json?: Json
          created_at?: string
          current_version?: number
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          subject_template: string
          template_key: string
          text_template?: string | null
          updated_at?: string
          variables?: Json
        }
        Update: {
          category?: string
          content_json?: Json
          created_at?: string
          current_version?: number
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          subject_template?: string
          template_key?: string
          text_template?: string | null
          updated_at?: string
          variables?: Json
        }
        Relationships: []
      }
      error_logs: {
        Row: {
          correlation_id: string | null
          created_at: string
          error_code: string | null
          error_message: string
          error_type: string
          function_name: string | null
          id: string
          metadata: Json | null
          request_body: Json | null
          request_method: string | null
          request_path: string | null
          severity: string
          source: string
          stack_trace: string | null
          user_id: string | null
        }
        Insert: {
          correlation_id?: string | null
          created_at?: string
          error_code?: string | null
          error_message: string
          error_type: string
          function_name?: string | null
          id?: string
          metadata?: Json | null
          request_body?: Json | null
          request_method?: string | null
          request_path?: string | null
          severity?: string
          source: string
          stack_trace?: string | null
          user_id?: string | null
        }
        Update: {
          correlation_id?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string
          error_type?: string
          function_name?: string | null
          id?: string
          metadata?: Json | null
          request_body?: Json | null
          request_method?: string | null
          request_path?: string | null
          severity?: string
          source?: string
          stack_trace?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "error_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "error_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          entity_id: string | null
          entity_type: string | null
          error_code: string | null
          error_message: string | null
          event_name: string
          id: string
          ip_hash: string | null
          properties: Json | null
          role: string | null
          session_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          error_code?: string | null
          error_message?: string | null
          event_name: string
          id?: string
          ip_hash?: string | null
          properties?: Json | null
          role?: string | null
          session_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          error_code?: string | null
          error_message?: string | null
          event_name?: string
          id?: string
          ip_hash?: string | null
          properties?: Json | null
          role?: string | null
          session_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      gallery_photos: {
        Row: {
          alt_text: string | null
          caption: string | null
          created_at: string
          file_name: string | null
          file_size: number | null
          id: string
          order_index: number
          photo_url: string
          updated_at: string
          user_id: string
        }
        Insert: {
          alt_text?: string | null
          caption?: string | null
          created_at?: string
          file_name?: string | null
          file_size?: number | null
          id?: string
          order_index?: number
          photo_url: string
          updated_at?: string
          user_id: string
        }
        Update: {
          alt_text?: string | null
          caption?: string | null
          created_at?: string
          file_name?: string | null
          file_size?: number | null
          id?: string
          order_index?: number
          photo_url?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      home_feed_items: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          is_test_account: boolean
          item_type: string
          metadata: Json
          source_id: string
          source_type: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_test_account?: boolean
          item_type: string
          metadata?: Json
          source_id: string
          source_type: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_test_account?: boolean
          item_type?: string
          metadata?: Json
          source_id?: string
          source_type?: string
        }
        Relationships: []
      }
      investor_share_tokens: {
        Row: {
          access_count: number
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          last_accessed_at: string | null
          name: string
          revoked_at: string | null
          token: string
        }
        Insert: {
          access_count?: number
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          last_accessed_at?: string | null
          name?: string
          revoked_at?: string | null
          token: string
        }
        Update: {
          access_count?: number
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          last_accessed_at?: string | null
          name?: string
          revoked_at?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "investor_share_tokens_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investor_share_tokens_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      message_digest_queue: {
        Row: {
          batch_ts: string
          created_at: string
          id: string
          notification_ids: string[]
          processed_at: string | null
          recipient_id: string
        }
        Insert: {
          batch_ts?: string
          created_at?: string
          id?: string
          notification_ids: string[]
          processed_at?: string | null
          recipient_id: string
        }
        Update: {
          batch_ts?: string
          created_at?: string
          id?: string
          notification_ids?: string[]
          processed_at?: string | null
          recipient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_digest_queue_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_digest_queue_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          id: string
          idempotency_key: string | null
          metadata: Json | null
          read_at: string | null
          sender_id: string
          sent_at: string
        }
        Insert: {
          content: string
          conversation_id: string
          id?: string
          idempotency_key?: string | null
          metadata?: Json | null
          read_at?: string | null
          sender_id: string
          sent_at?: string
        }
        Update: {
          content?: string
          conversation_id?: string
          id?: string
          idempotency_key?: string | null
          metadata?: Json | null
          read_at?: string | null
          sender_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_reminder_queue: {
        Row: {
          created_at: string
          id: string
          processed_at: string | null
          recipient_id: string
          reminder_number: number
        }
        Insert: {
          created_at?: string
          id?: string
          processed_at?: string | null
          recipient_id: string
          reminder_number: number
        }
        Update: {
          created_at?: string
          id?: string
          processed_at?: string | null
          recipient_id?: string
          reminder_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_reminder_queue_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_reminder_queue_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          application_deadline: string | null
          benefits: string[]
          closed_at: string | null
          club_id: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          custom_benefits: string[]
          description: string | null
          duration_text: string | null
          eu_passport_required: boolean
          gender: Database["public"]["Enums"]["opportunity_gender"] | null
          id: string
          location_city: string
          location_country: string
          opportunity_type: Database["public"]["Enums"]["opportunity_type"]
          organization_name: string | null
          position: Database["public"]["Enums"]["opportunity_position"] | null
          priority: Database["public"]["Enums"]["opportunity_priority"] | null
          published_at: string | null
          requirements: string[]
          search_vector: unknown
          start_date: string | null
          status: Database["public"]["Enums"]["opportunity_status"]
          title: string
          updated_at: string
          version: number
          world_club_id: string | null
        }
        Insert: {
          application_deadline?: string | null
          benefits?: string[]
          closed_at?: string | null
          club_id: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          custom_benefits?: string[]
          description?: string | null
          duration_text?: string | null
          eu_passport_required?: boolean
          gender?: Database["public"]["Enums"]["opportunity_gender"] | null
          id?: string
          location_city: string
          location_country: string
          opportunity_type?: Database["public"]["Enums"]["opportunity_type"]
          organization_name?: string | null
          position?: Database["public"]["Enums"]["opportunity_position"] | null
          priority?: Database["public"]["Enums"]["opportunity_priority"] | null
          published_at?: string | null
          requirements?: string[]
          search_vector?: unknown
          start_date?: string | null
          status?: Database["public"]["Enums"]["opportunity_status"]
          title: string
          updated_at?: string
          version?: number
          world_club_id?: string | null
        }
        Update: {
          application_deadline?: string | null
          benefits?: string[]
          closed_at?: string | null
          club_id?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          custom_benefits?: string[]
          description?: string | null
          duration_text?: string | null
          eu_passport_required?: boolean
          gender?: Database["public"]["Enums"]["opportunity_gender"] | null
          id?: string
          location_city?: string
          location_country?: string
          opportunity_type?: Database["public"]["Enums"]["opportunity_type"]
          organization_name?: string | null
          position?: Database["public"]["Enums"]["opportunity_position"] | null
          priority?: Database["public"]["Enums"]["opportunity_priority"] | null
          published_at?: string | null
          requirements?: string[]
          search_vector?: unknown
          start_date?: string | null
          status?: Database["public"]["Enums"]["opportunity_status"]
          title?: string
          updated_at?: string
          version?: number
          world_club_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_world_club_id_fkey"
            columns: ["world_club_id"]
            isOneToOne: false
            referencedRelation: "world_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_applications: {
        Row: {
          applicant_id: string
          applied_at: string
          id: string
          metadata: Json
          opportunity_id: string
          status: Database["public"]["Enums"]["application_status"]
          updated_at: string
        }
        Insert: {
          applicant_id: string
          applied_at?: string
          id?: string
          metadata?: Json
          opportunity_id: string
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
        }
        Update: {
          applicant_id?: string
          applied_at?: string
          id?: string
          metadata?: Json
          opportunity_id?: string
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_applications_applicant_id_fkey"
            columns: ["applicant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_applications_applicant_id_fkey"
            columns: ["applicant_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_applications_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_applications_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "public_opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_inbox_state: {
        Row: {
          last_seen_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          last_seen_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          last_seen_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_inbox_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_inbox_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_contacts: {
        Row: {
          club_name: string
          contact_name: string | null
          converted_at: string | null
          converted_profile_id: string | null
          country: string | null
          created_at: string
          email: string
          first_contacted_at: string | null
          id: string
          imported_by: string | null
          instagram: string | null
          last_contacted_at: string | null
          notes: string | null
          phone: string | null
          role_at_club: string | null
          source: string
          status: string
          updated_at: string
          world_club_id: string | null
        }
        Insert: {
          club_name: string
          contact_name?: string | null
          converted_at?: string | null
          converted_profile_id?: string | null
          country?: string | null
          created_at?: string
          email: string
          first_contacted_at?: string | null
          id?: string
          imported_by?: string | null
          instagram?: string | null
          last_contacted_at?: string | null
          notes?: string | null
          phone?: string | null
          role_at_club?: string | null
          source?: string
          status?: string
          updated_at?: string
          world_club_id?: string | null
        }
        Update: {
          club_name?: string
          contact_name?: string | null
          converted_at?: string | null
          converted_profile_id?: string | null
          country?: string | null
          created_at?: string
          email?: string
          first_contacted_at?: string | null
          id?: string
          imported_by?: string | null
          instagram?: string | null
          last_contacted_at?: string | null
          notes?: string | null
          phone?: string | null
          role_at_club?: string | null
          source?: string
          status?: string
          updated_at?: string
          world_club_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_contacts_converted_profile_id_fkey"
            columns: ["converted_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_contacts_converted_profile_id_fkey"
            columns: ["converted_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_contacts_world_club_id_fkey"
            columns: ["world_club_id"]
            isOneToOne: false
            referencedRelation: "world_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      post_comments: {
        Row: {
          author_id: string
          content: string
          created_at: string
          deleted_at: string | null
          id: string
          post_id: string
        }
        Insert: {
          author_id: string
          content: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          post_id: string
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "user_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_likes: {
        Row: {
          created_at: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "user_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_comments: {
        Row: {
          author_profile_id: string
          content: string
          created_at: string
          id: string
          profile_id: string
          rating: Database["public"]["Enums"]["comment_rating"] | null
          status: Database["public"]["Enums"]["comment_status"]
          updated_at: string
        }
        Insert: {
          author_profile_id: string
          content: string
          created_at?: string
          id?: string
          profile_id: string
          rating?: Database["public"]["Enums"]["comment_rating"] | null
          status?: Database["public"]["Enums"]["comment_status"]
          updated_at?: string
        }
        Update: {
          author_profile_id?: string
          content?: string
          created_at?: string
          id?: string
          profile_id?: string
          rating?: Database["public"]["Enums"]["comment_rating"] | null
          status?: Database["public"]["Enums"]["comment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_comments_author_profile_id_fkey"
            columns: ["author_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_comments_author_profile_id_fkey"
            columns: ["author_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_comments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_comments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_friendships: {
        Row: {
          accepted_at: string | null
          created_at: string
          id: string
          pair_key_lower: string | null
          pair_key_upper: string | null
          requester_id: string
          status: Database["public"]["Enums"]["friendship_status"]
          updated_at: string
          user_one: string
          user_two: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          pair_key_lower?: string | null
          pair_key_upper?: string | null
          requester_id: string
          status?: Database["public"]["Enums"]["friendship_status"]
          updated_at?: string
          user_one: string
          user_two: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          pair_key_lower?: string | null
          pair_key_upper?: string | null
          requester_id?: string
          status?: Database["public"]["Enums"]["friendship_status"]
          updated_at?: string
          user_one?: string
          user_two?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_friendships_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_friendships_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_friendships_user_one_fkey"
            columns: ["user_one"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_friendships_user_one_fkey"
            columns: ["user_one"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_friendships_user_two_fkey"
            columns: ["user_two"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_friendships_user_two_fkey"
            columns: ["user_two"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_milestones: {
        Row: {
          achieved_at: string
          id: string
          milestone_type: string
          profile_id: string
        }
        Insert: {
          achieved_at?: string
          id?: string
          milestone_type: string
          profile_id: string
        }
        Update: {
          achieved_at?: string
          id?: string
          milestone_type?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_milestones_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_milestones_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_notifications: {
        Row: {
          actor_profile_id: string | null
          cleared_at: string | null
          created_at: string
          emailed_at: string | null
          id: string
          kind: Database["public"]["Enums"]["profile_notification_kind"]
          metadata: Json
          read_at: string | null
          recipient_profile_id: string
          seen_at: string | null
          source_entity_id: string | null
          target_url: string | null
          updated_at: string
        }
        Insert: {
          actor_profile_id?: string | null
          cleared_at?: string | null
          created_at?: string
          emailed_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["profile_notification_kind"]
          metadata?: Json
          read_at?: string | null
          recipient_profile_id: string
          seen_at?: string | null
          source_entity_id?: string | null
          target_url?: string | null
          updated_at?: string
        }
        Update: {
          actor_profile_id?: string | null
          cleared_at?: string | null
          created_at?: string
          emailed_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["profile_notification_kind"]
          metadata?: Json
          read_at?: string | null
          recipient_profile_id?: string
          seen_at?: string | null
          source_entity_id?: string | null
          target_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_notifications_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_notifications_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_notifications_recipient_profile_id_fkey"
            columns: ["recipient_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_notifications_recipient_profile_id_fkey"
            columns: ["recipient_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_references: {
        Row: {
          accepted_at: string | null
          created_at: string
          endorsement_text: string | null
          id: string
          reference_id: string
          relationship_type: string
          request_note: string | null
          requester_id: string
          responded_at: string | null
          revoked_at: string | null
          revoked_by: string | null
          status: Database["public"]["Enums"]["profile_reference_status"]
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          endorsement_text?: string | null
          id?: string
          reference_id: string
          relationship_type: string
          request_note?: string | null
          requester_id: string
          responded_at?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          status?: Database["public"]["Enums"]["profile_reference_status"]
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          endorsement_text?: string | null
          id?: string
          reference_id?: string
          relationship_type?: string
          request_note?: string | null
          requester_id?: string
          responded_at?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          status?: Database["public"]["Enums"]["profile_reference_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_references_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_references_reference_id_fkey"
            columns: ["reference_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_references_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_references_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_references_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_references_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_search_appearances: {
        Row: {
          created_at: string
          filters: Json
          hour_bucket: string | null
          id: string
          profile_id: string
          viewer_id: string
        }
        Insert: {
          created_at?: string
          filters?: Json
          hour_bucket?: string | null
          id?: string
          profile_id: string
          viewer_id: string
        }
        Update: {
          created_at?: string
          filters?: Json
          hour_bucket?: string | null
          id?: string
          profile_id?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_search_appearances_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_search_appearances_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_search_appearances_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_search_appearances_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_view_email_queue: {
        Row: {
          anonymous_viewers: number
          created_at: string
          id: string
          processed_at: string | null
          recipient_id: string
          top_viewer_ids: string[]
          total_views: number
          unique_viewers: number
        }
        Insert: {
          anonymous_viewers?: number
          created_at?: string
          id?: string
          processed_at?: string | null
          recipient_id: string
          top_viewer_ids?: string[]
          total_views?: number
          unique_viewers?: number
        }
        Update: {
          anonymous_viewers?: number
          created_at?: string
          id?: string
          processed_at?: string | null
          recipient_id?: string
          top_viewer_ids?: string[]
          total_views?: number
          unique_viewers?: number
        }
        Relationships: [
          {
            foreignKeyName: "profile_view_email_queue_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_view_email_queue_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          accepted_friend_count: number
          accepted_reference_count: number
          avatar_url: string | null
          base_city: string | null
          base_country_id: number | null
          base_location: string | null
          bio: string | null
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          brand_representation: string | null
          browse_anonymously: boolean
          career_entry_count: number
          club_bio: string | null
          club_history: string | null
          coach_specialization: string | null
          coach_specialization_custom: string | null
          contact_email: string | null
          contact_email_public: boolean
          created_at: string
          current_club: string | null
          current_world_club_id: string | null
          date_of_birth: string | null
          email: string
          federation: string | null
          full_name: string | null
          gender: string | null
          highlight_video_url: string | null
          highlight_visibility: string
          id: string
          is_blocked: boolean
          is_test_account: boolean
          is_verified: boolean
          languages: string[] | null
          last_active_at: string | null
          last_message_email_at: string | null
          last_officiated_at: string | null
          last_platform: string | null
          last_profile_view_email_at: string | null
          league_division: string | null
          mens_league_division: string | null
          mens_league_id: number | null
          nationality: string | null
          nationality_country_id: number | null
          nationality2_country_id: number | null
          notify_applications: boolean
          notify_friends: boolean
          notify_messages: boolean
          notify_opportunities: boolean
          notify_profile_views: boolean
          notify_push: boolean
          notify_references: boolean
          officiating_specialization: string | null
          onboarding_completed: boolean
          onboarding_completed_at: string | null
          onboarding_started_at: string | null
          open_to_coach: boolean
          open_to_opportunities: boolean
          open_to_play: boolean
          position: string | null
          post_count: number
          role: string
          search_vector: unknown
          secondary_position: string | null
          social_links: Json | null
          umpire_appointment_count: number
          umpire_level: string | null
          umpire_since: number | null
          updated_at: string
          username: string | null
          verified_at: string | null
          verified_by: string | null
          version: number
          website: string | null
          womens_league_division: string | null
          womens_league_id: number | null
          world_region_id: number | null
          year_founded: number | null
        }
        Insert: {
          accepted_friend_count?: number
          accepted_reference_count?: number
          avatar_url?: string | null
          base_city?: string | null
          base_country_id?: number | null
          base_location?: string | null
          bio?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          brand_representation?: string | null
          browse_anonymously?: boolean
          career_entry_count?: number
          club_bio?: string | null
          club_history?: string | null
          coach_specialization?: string | null
          coach_specialization_custom?: string | null
          contact_email?: string | null
          contact_email_public?: boolean
          created_at?: string
          current_club?: string | null
          current_world_club_id?: string | null
          date_of_birth?: string | null
          email: string
          federation?: string | null
          full_name?: string | null
          gender?: string | null
          highlight_video_url?: string | null
          highlight_visibility?: string
          id: string
          is_blocked?: boolean
          is_test_account?: boolean
          is_verified?: boolean
          languages?: string[] | null
          last_active_at?: string | null
          last_message_email_at?: string | null
          last_officiated_at?: string | null
          last_platform?: string | null
          last_profile_view_email_at?: string | null
          league_division?: string | null
          mens_league_division?: string | null
          mens_league_id?: number | null
          nationality?: string | null
          nationality_country_id?: number | null
          nationality2_country_id?: number | null
          notify_applications?: boolean
          notify_friends?: boolean
          notify_messages?: boolean
          notify_opportunities?: boolean
          notify_profile_views?: boolean
          notify_push?: boolean
          notify_references?: boolean
          officiating_specialization?: string | null
          onboarding_completed?: boolean
          onboarding_completed_at?: string | null
          onboarding_started_at?: string | null
          open_to_coach?: boolean
          open_to_opportunities?: boolean
          open_to_play?: boolean
          position?: string | null
          post_count?: number
          role: string
          search_vector?: unknown
          secondary_position?: string | null
          social_links?: Json | null
          umpire_appointment_count?: number
          umpire_level?: string | null
          umpire_since?: number | null
          updated_at?: string
          username?: string | null
          verified_at?: string | null
          verified_by?: string | null
          version?: number
          website?: string | null
          womens_league_division?: string | null
          womens_league_id?: number | null
          world_region_id?: number | null
          year_founded?: number | null
        }
        Update: {
          accepted_friend_count?: number
          accepted_reference_count?: number
          avatar_url?: string | null
          base_city?: string | null
          base_country_id?: number | null
          base_location?: string | null
          bio?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          brand_representation?: string | null
          browse_anonymously?: boolean
          career_entry_count?: number
          club_bio?: string | null
          club_history?: string | null
          coach_specialization?: string | null
          coach_specialization_custom?: string | null
          contact_email?: string | null
          contact_email_public?: boolean
          created_at?: string
          current_club?: string | null
          current_world_club_id?: string | null
          date_of_birth?: string | null
          email?: string
          federation?: string | null
          full_name?: string | null
          gender?: string | null
          highlight_video_url?: string | null
          highlight_visibility?: string
          id?: string
          is_blocked?: boolean
          is_test_account?: boolean
          is_verified?: boolean
          languages?: string[] | null
          last_active_at?: string | null
          last_message_email_at?: string | null
          last_officiated_at?: string | null
          last_platform?: string | null
          last_profile_view_email_at?: string | null
          league_division?: string | null
          mens_league_division?: string | null
          mens_league_id?: number | null
          nationality?: string | null
          nationality_country_id?: number | null
          nationality2_country_id?: number | null
          notify_applications?: boolean
          notify_friends?: boolean
          notify_messages?: boolean
          notify_opportunities?: boolean
          notify_profile_views?: boolean
          notify_push?: boolean
          notify_references?: boolean
          officiating_specialization?: string | null
          onboarding_completed?: boolean
          onboarding_completed_at?: string | null
          onboarding_started_at?: string | null
          open_to_coach?: boolean
          open_to_opportunities?: boolean
          open_to_play?: boolean
          position?: string | null
          post_count?: number
          role?: string
          search_vector?: unknown
          secondary_position?: string | null
          social_links?: Json | null
          umpire_appointment_count?: number
          umpire_level?: string | null
          umpire_since?: number | null
          updated_at?: string
          username?: string | null
          verified_at?: string | null
          verified_by?: string | null
          version?: number
          website?: string | null
          womens_league_division?: string | null
          womens_league_id?: number | null
          world_region_id?: number | null
          year_founded?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_base_country_id_fkey"
            columns: ["base_country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_base_country_id_fkey"
            columns: ["base_country_id"]
            isOneToOne: false
            referencedRelation: "world_countries_with_directory"
            referencedColumns: ["country_id"]
          },
          {
            foreignKeyName: "profiles_current_world_club_id_fkey"
            columns: ["current_world_club_id"]
            isOneToOne: false
            referencedRelation: "world_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_mens_league_id_fkey"
            columns: ["mens_league_id"]
            isOneToOne: false
            referencedRelation: "world_leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_nationality_country_id_fkey"
            columns: ["nationality_country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_nationality_country_id_fkey"
            columns: ["nationality_country_id"]
            isOneToOne: false
            referencedRelation: "world_countries_with_directory"
            referencedColumns: ["country_id"]
          },
          {
            foreignKeyName: "profiles_nationality2_country_id_fkey"
            columns: ["nationality2_country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_nationality2_country_id_fkey"
            columns: ["nationality2_country_id"]
            isOneToOne: false
            referencedRelation: "world_countries_with_directory"
            referencedColumns: ["country_id"]
          },
          {
            foreignKeyName: "profiles_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_womens_league_id_fkey"
            columns: ["womens_league_id"]
            isOneToOne: false
            referencedRelation: "world_leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_world_region_id_fkey"
            columns: ["world_region_id"]
            isOneToOne: false
            referencedRelation: "world_province_stats"
            referencedColumns: ["province_id"]
          },
          {
            foreignKeyName: "profiles_world_region_id_fkey"
            columns: ["world_region_id"]
            isOneToOne: false
            referencedRelation: "world_provinces"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string | null
          created_at: string
          endpoint: string | null
          fcm_token: string | null
          id: string
          last_used_at: string | null
          p256dh: string | null
          platform: string | null
          profile_id: string
          user_agent: string | null
        }
        Insert: {
          auth?: string | null
          created_at?: string
          endpoint?: string | null
          fcm_token?: string | null
          id?: string
          last_used_at?: string | null
          p256dh?: string | null
          platform?: string | null
          profile_id: string
          user_agent?: string | null
        }
        Update: {
          auth?: string | null
          created_at?: string
          endpoint?: string | null
          fcm_token?: string | null
          id?: string
          last_used_at?: string | null
          p256dh?: string | null
          platform?: string | null
          profile_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      pwa_installs: {
        Row: {
          id: string
          installed_at: string
          platform: string
          profile_id: string
          user_agent: string | null
        }
        Insert: {
          id?: string
          installed_at?: string
          platform: string
          profile_id: string
          user_agent?: string | null
        }
        Update: {
          id?: string
          installed_at?: string
          platform?: string
          profile_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pwa_installs_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pwa_installs_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          action_type: string
          created_at: string
          id: string
          identifier: string
        }
        Insert: {
          action_type: string
          created_at?: string
          id?: string
          identifier: string
        }
        Update: {
          action_type?: string
          created_at?: string
          id?: string
          identifier?: string
        }
        Relationships: []
      }
      storage_cleanup_queue: {
        Row: {
          attempts: number
          bucket_id: string
          id: string
          last_error: string | null
          object_path: string
          processed_at: string | null
          queued_at: string
          reason: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          bucket_id: string
          id?: string
          last_error?: string | null
          object_path: string
          processed_at?: string | null
          queued_at?: string
          reason: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          bucket_id?: string
          id?: string
          last_error?: string | null
          object_path?: string
          processed_at?: string | null
          queued_at?: string
          reason?: string
          updated_at?: string
        }
        Relationships: []
      }
      terms_acceptance: {
        Row: {
          accepted_at: string
          id: string
          user_id: string
          version: string
        }
        Insert: {
          accepted_at?: string
          id?: string
          user_id: string
          version?: string
        }
        Update: {
          accepted_at?: string
          id?: string
          user_id?: string
          version?: string
        }
        Relationships: []
      }
      umpire_appointments: {
        Row: {
          created_at: string
          description: string | null
          display_order: number
          end_date: string | null
          entry_type: Database["public"]["Enums"]["umpire_journey_entry_type"]
          event_name: string
          id: string
          image_url: string | null
          location_city: string | null
          location_country: string | null
          match_format: string | null
          match_level: string | null
          organizer: string | null
          start_date: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_order?: number
          end_date?: string | null
          entry_type?: Database["public"]["Enums"]["umpire_journey_entry_type"]
          event_name: string
          id?: string
          image_url?: string | null
          location_city?: string | null
          location_country?: string | null
          match_format?: string | null
          match_level?: string | null
          organizer?: string | null
          start_date?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_order?: number
          end_date?: string | null
          entry_type?: Database["public"]["Enums"]["umpire_journey_entry_type"]
          event_name?: string
          id?: string
          image_url?: string | null
          location_city?: string | null
          location_country?: string | null
          match_format?: string | null
          match_level?: string | null
          organizer?: string | null
          start_date?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "umpire_appointments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "umpire_appointments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      user_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          id?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      user_devices: {
        Row: {
          created_at: string
          id: string
          is_pwa: boolean
          last_seen_at: string
          platform: string
          profile_id: string
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_pwa?: boolean
          last_seen_at?: string
          platform: string
          profile_id: string
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_pwa?: boolean
          last_seen_at?: string
          platform?: string
          profile_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_devices_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_devices_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      user_engagement_daily: {
        Row: {
          created_at: string
          date: string
          first_heartbeat_at: string | null
          heartbeat_count: number
          last_heartbeat_at: string | null
          session_count: number
          total_seconds: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          first_heartbeat_at?: string | null
          heartbeat_count?: number
          last_heartbeat_at?: string | null
          session_count?: number
          total_seconds?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          first_heartbeat_at?: string | null
          heartbeat_count?: number
          last_heartbeat_at?: string | null
          session_count?: number
          total_seconds?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_engagement_daily_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_engagement_daily_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      user_engagement_heartbeats: {
        Row: {
          created_at: string
          id: string
          session_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          session_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_engagement_heartbeats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_engagement_heartbeats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      user_posts: {
        Row: {
          author_id: string
          comment_count: number
          content: string
          created_at: string
          deleted_at: string | null
          id: string
          images: Json | null
          like_count: number
          metadata: Json | null
          post_type: string
          search_vector: unknown
          updated_at: string
        }
        Insert: {
          author_id: string
          comment_count?: number
          content: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          images?: Json | null
          like_count?: number
          metadata?: Json | null
          post_type?: string
          search_vector?: unknown
          updated_at?: string
        }
        Update: {
          author_id?: string
          comment_count?: number
          content?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          images?: Json | null
          like_count?: number
          metadata?: Json | null
          post_type?: string
          search_vector?: unknown
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      user_reports: {
        Row: {
          category: string
          content_id: string | null
          content_type: string | null
          created_at: string
          id: string
          reason: string
          reporter_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          target_id: string
        }
        Insert: {
          category?: string
          content_id?: string | null
          content_type?: string | null
          created_at?: string
          id?: string
          reason: string
          reporter_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          target_id: string
        }
        Update: {
          category?: string
          content_id?: string | null
          content_type?: string | null
          created_at?: string
          id?: string
          reason?: string
          reporter_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_reports_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_reports_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      user_unread_counters: {
        Row: {
          unread_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          unread_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          unread_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_unread_counters_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_unread_counters_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      user_unread_senders: {
        Row: {
          sender_id: string
          unread_message_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          sender_id: string
          unread_message_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          sender_id?: string
          unread_message_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_unread_senders_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_unread_senders_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_unread_senders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_unread_senders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      world_clubs: {
        Row: {
          avatar_url: string | null
          claimed_at: string | null
          claimed_profile_id: string | null
          club_id: string
          club_name: string
          club_name_normalized: string
          country_id: number
          created_at: string
          created_from: string
          id: string
          is_claimed: boolean
          men_league_id: number | null
          province_id: number | null
          updated_at: string
          women_league_id: number | null
        }
        Insert: {
          avatar_url?: string | null
          claimed_at?: string | null
          claimed_profile_id?: string | null
          club_id: string
          club_name: string
          club_name_normalized: string
          country_id: number
          created_at?: string
          created_from?: string
          id?: string
          is_claimed?: boolean
          men_league_id?: number | null
          province_id?: number | null
          updated_at?: string
          women_league_id?: number | null
        }
        Update: {
          avatar_url?: string | null
          claimed_at?: string | null
          claimed_profile_id?: string | null
          club_id?: string
          club_name?: string
          club_name_normalized?: string
          country_id?: number
          created_at?: string
          created_from?: string
          id?: string
          is_claimed?: boolean
          men_league_id?: number | null
          province_id?: number | null
          updated_at?: string
          women_league_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "world_clubs_claimed_profile_id_fkey"
            columns: ["claimed_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "world_clubs_claimed_profile_id_fkey"
            columns: ["claimed_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "world_clubs_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "world_clubs_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "world_countries_with_directory"
            referencedColumns: ["country_id"]
          },
          {
            foreignKeyName: "world_clubs_men_league_id_fkey"
            columns: ["men_league_id"]
            isOneToOne: false
            referencedRelation: "world_leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "world_clubs_province_id_fkey"
            columns: ["province_id"]
            isOneToOne: false
            referencedRelation: "world_province_stats"
            referencedColumns: ["province_id"]
          },
          {
            foreignKeyName: "world_clubs_province_id_fkey"
            columns: ["province_id"]
            isOneToOne: false
            referencedRelation: "world_provinces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "world_clubs_women_league_id_fkey"
            columns: ["women_league_id"]
            isOneToOne: false
            referencedRelation: "world_leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      world_leagues: {
        Row: {
          country_id: number | null
          created_at: string
          display_order: number | null
          id: number
          logical_id: string | null
          name: string
          province_id: number | null
          slug: string | null
          tier: number | null
          updated_at: string
        }
        Insert: {
          country_id?: number | null
          created_at?: string
          display_order?: number | null
          id?: number
          logical_id?: string | null
          name: string
          province_id?: number | null
          slug?: string | null
          tier?: number | null
          updated_at?: string
        }
        Update: {
          country_id?: number | null
          created_at?: string
          display_order?: number | null
          id?: number
          logical_id?: string | null
          name?: string
          province_id?: number | null
          slug?: string | null
          tier?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "world_leagues_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "world_leagues_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "world_countries_with_directory"
            referencedColumns: ["country_id"]
          },
          {
            foreignKeyName: "world_leagues_province_id_fkey"
            columns: ["province_id"]
            isOneToOne: false
            referencedRelation: "world_province_stats"
            referencedColumns: ["province_id"]
          },
          {
            foreignKeyName: "world_leagues_province_id_fkey"
            columns: ["province_id"]
            isOneToOne: false
            referencedRelation: "world_provinces"
            referencedColumns: ["id"]
          },
        ]
      }
      world_provinces: {
        Row: {
          country_id: number
          created_at: string
          description: string | null
          display_order: number | null
          id: number
          logical_id: string | null
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          country_id: number
          created_at?: string
          description?: string | null
          display_order?: number | null
          id?: number
          logical_id?: string | null
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          country_id?: number
          created_at?: string
          description?: string | null
          display_order?: number | null
          id?: number
          logical_id?: string | null
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "world_provinces_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "world_provinces_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "world_countries_with_directory"
            referencedColumns: ["country_id"]
          },
        ]
      }
    }
    Views: {
      country_migration_stats: {
        Row: {
          nationality_pending_review: number | null
          profiles_with_nationality_id: number | null
          profiles_with_nationality_text: number | null
          total_completed_profiles: number | null
        }
        Relationships: []
      }
      email_template_stats: {
        Row: {
          category: string | null
          click_rate: number | null
          delivery_rate: number | null
          is_active: boolean | null
          name: string | null
          open_rate: number | null
          template_id: string | null
          template_key: string | null
          total_bounced: number | null
          total_clicked: number | null
          total_complained: number | null
          total_delivered: number | null
          total_opened: number | null
          total_sent: number | null
          total_unsubscribed: number | null
        }
        Relationships: []
      }
      profile_friend_edges: {
        Row: {
          accepted_at: string | null
          created_at: string | null
          friend_id: string | null
          id: string | null
          pair_key_lower: string | null
          pair_key_upper: string | null
          profile_id: string | null
          requester_id: string | null
          status: Database["public"]["Enums"]["friendship_status"] | null
          updated_at: string | null
          user_one: string | null
          user_two: string | null
        }
        Relationships: []
      }
      profiles_pending_country_review: {
        Row: {
          email: string | null
          full_name: string | null
          id: string | null
          nationality_country_id: number | null
          nationality_country_name: string | null
          nationality_needs_review: boolean | null
          nationality_text: string | null
          role: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_nationality_country_id_fkey"
            columns: ["nationality_country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_nationality_country_id_fkey"
            columns: ["nationality_country_id"]
            isOneToOne: false
            referencedRelation: "world_countries_with_directory"
            referencedColumns: ["country_id"]
          },
        ]
      }
      public_opportunities: {
        Row: {
          application_deadline: string | null
          benefits: string[] | null
          club_league: string | null
          club_location: string | null
          club_logo_url: string | null
          club_name: string | null
          created_at: string | null
          custom_benefits: string[] | null
          description: string | null
          duration_text: string | null
          eu_passport_required: boolean | null
          gender: Database["public"]["Enums"]["opportunity_gender"] | null
          id: string | null
          location_city: string | null
          location_country: string | null
          opportunity_type:
            | Database["public"]["Enums"]["opportunity_type"]
            | null
          organization_name: string | null
          position: Database["public"]["Enums"]["opportunity_position"] | null
          priority: Database["public"]["Enums"]["opportunity_priority"] | null
          published_at: string | null
          publisher_current_club: string | null
          publisher_role: string | null
          requirements: string[] | null
          start_date: string | null
          title: string | null
          world_club_avatar_url: string | null
          world_club_league: string | null
          world_club_name: string | null
        }
        Relationships: []
      }
      user_unread_counts: {
        Row: {
          unread_count: number | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          unread_count?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          unread_count?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_unread_counters_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_unread_counters_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      user_unread_counts_secure: {
        Row: {
          unread_count: number | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          unread_count?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          unread_count?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_unread_counters_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_unread_counters_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles_pending_country_review"
            referencedColumns: ["id"]
          },
        ]
      }
      world_countries_with_directory: {
        Row: {
          country_code: string | null
          country_id: number | null
          country_name: string | null
          flag_emoji: string | null
          has_regions: boolean | null
          region: string | null
          total_clubs: number | null
          total_leagues: number | null
        }
        Relationships: []
      }
      world_province_stats: {
        Row: {
          claimed_clubs: number | null
          country_code: string | null
          country_id: number | null
          country_name: string | null
          description: string | null
          display_order: number | null
          province_id: number | null
          province_name: string | null
          slug: string | null
          total_clubs: number | null
          total_leagues: number | null
        }
        Relationships: [
          {
            foreignKeyName: "world_provinces_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "world_provinces_country_id_fkey"
            columns: ["country_id"]
            isOneToOne: false
            referencedRelation: "world_countries_with_directory"
            referencedColumns: ["country_id"]
          },
        ]
      }
    }
    Functions: {
      _enqueue_user_post_media: {
        Args: { p_images: Json; p_post_id: string; p_reason: string }
        Returns: undefined
      }
      accept_terms: { Args: { p_version?: string }; Returns: undefined }
      acquire_profile_lock: { Args: { profile_id: string }; Returns: boolean }
      add_brand_ambassador: {
        Args: { p_brand_id: string; p_player_id: string }
        Returns: Json
      }
      admin_activate_email_template: {
        Args: { p_template_id: string; p_version_number: number }
        Returns: undefined
      }
      admin_add_outreach_contact: {
        Args: {
          p_club_name: string
          p_contact_name?: string
          p_country?: string
          p_email: string
          p_instagram?: string
          p_notes?: string
          p_role_at_club?: string
        }
        Returns: Json
      }
      admin_backfill_email_statuses: { Args: never; Returns: Json }
      admin_block_user: {
        Args: { p_profile_id: string; p_reason?: string }
        Returns: Json
      }
      admin_bulk_import_outreach_contacts: {
        Args: { p_contacts: Json }
        Returns: Json
      }
      admin_count_campaign_recipients: {
        Args: { p_audience_filter?: Json; p_audience_source?: string }
        Returns: number
      }
      admin_create_email_campaign:
        | {
            Args: {
              p_audience_filter?: Json
              p_category?: string
              p_name: string
              p_template_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_audience_filter?: Json
              p_audience_source?: string
              p_category?: string
              p_name: string
              p_template_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_ab_variants?: Json
              p_audience_filter?: Json
              p_audience_source?: string
              p_category?: string
              p_name: string
              p_template_id: string
            }
            Returns: Json
          }
      admin_create_investor_token: {
        Args: { p_expires_in_days?: number; p_name?: string }
        Returns: Json
      }
      admin_delete_email_campaign: {
        Args: { p_campaign_id: string }
        Returns: Json
      }
      admin_delete_orphan_profile: {
        Args: { p_profile_id: string }
        Returns: Json
      }
      admin_diagnose_email_metrics: { Args: never; Returns: Json }
      admin_duplicate_email_campaign: {
        Args: { p_campaign_id: string }
        Returns: Json
      }
      admin_duplicate_email_template: {
        Args: { p_template_id: string }
        Returns: Json
      }
      admin_get_activation_funnel: { Args: { p_days?: number }; Returns: Json }
      admin_get_audit_logs: {
        Args: {
          p_action?: string
          p_admin_id?: string
          p_limit?: number
          p_offset?: number
          p_target_type?: string
        }
        Returns: {
          action: string
          admin_email: string
          admin_id: string
          admin_name: string
          created_at: string
          id: string
          metadata: Json
          new_data: Json
          old_data: Json
          target_id: string
          target_type: string
          total_count: number
        }[]
      }
      admin_get_auth_orphans: {
        Args: never
        Returns: {
          created_at: string
          email: string
          email_confirmed_at: string
          intended_role: string
          last_sign_in_at: string
          user_id: string
        }[]
      }
      admin_get_brand_activity: {
        Args: { p_days?: number; p_limit?: number; p_offset?: number }
        Returns: {
          brand_id: string
          brand_name: string
          category: string
          created_at: string
          is_verified: boolean
          last_activity_at: string
          logo_url: string
          onboarding_completed: boolean
          post_count: number
          product_count: number
          slug: string
          total_count: number
        }[]
      }
      admin_get_brand_summary: { Args: never; Returns: Json }
      admin_get_broken_references: { Args: never; Returns: Json }
      admin_get_campaign_detail: {
        Args: { p_campaign_id: string }
        Returns: Json
      }
      admin_get_campaign_email_metrics: {
        Args: { p_campaign_id: string }
        Returns: {
          bounced: number
          clicked: number
          delivered: number
          opened: number
          total: number
        }[]
      }
      admin_get_campaign_variant_metrics: {
        Args: { p_campaign_id: string }
        Returns: {
          bounced: number
          clicked: number
          delivered: number
          opened: number
          total: number
          variant: string
        }[]
      }
      admin_get_churn_analysis: {
        Args: { p_days?: number; p_exclude_test?: boolean }
        Returns: Json
      }
      admin_get_club_activity: {
        Args: { p_days?: number; p_limit?: number; p_offset?: number }
        Returns: {
          avatar_url: string
          avg_apps_per_vacancy: number
          base_location: string
          club_id: string
          club_name: string
          last_posted_at: string
          onboarding_completed: boolean
          open_vacancy_count: number
          total_applications: number
          total_count: number
          vacancy_count: number
        }[]
      }
      admin_get_club_summary: { Args: never; Returns: Json }
      admin_get_command_center: { Args: { p_days?: number }; Returns: Json }
      admin_get_community_analytics: {
        Args: { p_days?: number; p_exclude_test?: boolean }
        Returns: Json
      }
      admin_get_conversion_funnels: {
        Args: { p_days?: number; p_exclude_test?: boolean }
        Returns: Json
      }
      admin_get_cross_feature_attribution: {
        Args: {
          p_days?: number
          p_exclude_test?: boolean
          p_window_hours?: number
        }
        Returns: Json
      }
      admin_get_dashboard_stats: { Args: never; Returns: Json }
      admin_get_device_users: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_platform?: string
          p_search?: string
        }
        Returns: Json
      }
      admin_get_discovery_analytics: {
        Args: { p_days?: number; p_exclude_test?: boolean }
        Returns: Json
      }
      admin_get_email_campaigns: {
        Args: {
          p_category?: string
          p_limit?: number
          p_offset?: number
          p_status?: string
        }
        Returns: Json[]
      }
      admin_get_email_contacts: {
        Args: {
          p_country?: string
          p_limit?: number
          p_offset?: number
          p_role?: string
          p_search?: string
        }
        Returns: Json[]
      }
      admin_get_email_contacts_summary: { Args: never; Returns: Json }
      admin_get_email_engagement_explorer:
        | {
            Args: {
              p_campaign_id?: string
              p_country?: string
              p_limit?: number
              p_offset?: number
              p_role?: string
              p_status?: string
              p_template_key?: string
            }
            Returns: Json[]
          }
        | {
            Args: {
              p_campaign_id?: string
              p_country?: string
              p_limit?: number
              p_offset?: number
              p_role?: string
              p_since?: string
              p_status?: string
              p_template_key?: string
              p_until?: string
            }
            Returns: Json[]
          }
      admin_get_email_overview: { Args: { p_days?: number }; Returns: Json }
      admin_get_email_send_stats: {
        Args: {
          p_campaign_id?: string
          p_days?: number
          p_template_key?: string
        }
        Returns: Json
      }
      admin_get_email_template_detail: {
        Args: { p_template_id: string }
        Returns: Json
      }
      admin_get_email_templates: { Args: never; Returns: Json }
      admin_get_engagement_summary: { Args: never; Returns: Json }
      admin_get_product_health_score: { Args: never; Returns: Json }
      admin_get_engagement_trends: {
        Args: { p_days?: number }
        Returns: {
          active_users: number
          date: string
          total_minutes: number
          total_sessions: number
        }[]
      }
      admin_get_extended_dashboard_stats: { Args: never; Returns: Json }
      admin_get_feature_usage_metrics: {
        Args: { p_days?: number; p_exclude_test?: boolean }
        Returns: Json
      }
      admin_get_feed_analytics: {
        Args: { p_days?: number; p_exclude_test?: boolean }
        Returns: Json
      }
      admin_get_friendship_metrics: {
        Args: { p_days?: number; p_exclude_test?: boolean; p_role?: string }
        Returns: Json
      }
      admin_get_investor_metrics: { Args: { p_days?: number }; Returns: Json }
      admin_get_investor_signup_trends: {
        Args: { p_days?: number }
        Returns: {
          clubs: number
          coaches: number
          cumulative_total: number
          date: string
          players: number
          total_signups: number
        }[]
      }
      admin_get_marketplace_health: {
        Args: { p_days?: number; p_exclude_test?: boolean }
        Returns: Json
      }
      admin_get_messaging_health: {
        Args: { p_days?: number; p_exclude_test?: boolean }
        Returns: Json
      }
      admin_get_messaging_metrics: {
        Args: { p_days?: number; p_exclude_test?: boolean; p_role?: string }
        Returns: Json
      }
      admin_get_monthly_report: {
        Args: { p_month?: number; p_year?: number }
        Returns: Json
      }
      admin_get_notification_effectiveness: {
        Args: { p_days?: number; p_exclude_test?: boolean }
        Returns: Json
      }
      admin_get_onboarding_funnel_detail: {
        Args: { p_days?: number; p_exclude_test?: boolean; p_role?: string }
        Returns: Json
      }
      admin_get_opportunities: {
        Args: {
          p_club_id?: string
          p_days?: number
          p_limit?: number
          p_offset?: number
          p_status?: Database["public"]["Enums"]["opportunity_status"]
        }
        Returns: {
          application_count: number
          application_deadline: string
          club_avatar_url: string
          club_id: string
          club_name: string
          created_at: string
          first_application_at: string
          id: string
          location_city: string
          location_country: string
          opportunity_type: Database["public"]["Enums"]["opportunity_type"]
          pending_count: number
          position: Database["public"]["Enums"]["opportunity_position"]
          published_at: string
          shortlisted_count: number
          status: Database["public"]["Enums"]["opportunity_status"]
          time_to_first_app_minutes: number
          title: string
          total_count: number
        }[]
      }
      admin_get_opportunity_applicants: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_opportunity_id: string
          p_status?: Database["public"]["Enums"]["application_status"]
        }
        Returns: {
          application_id: string
          applied_at: string
          avatar_url: string
          highlight_video_url: string
          nationality: string
          onboarding_completed: boolean
          player_email: string
          player_id: string
          player_name: string
          position: string
          status: Database["public"]["Enums"]["application_status"]
          total_count: number
        }[]
      }
      admin_get_opportunity_detail: {
        Args: { p_opportunity_id: string }
        Returns: Json
      }
      admin_get_outreach_contacts: {
        Args: {
          p_country?: string
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_status?: string
        }
        Returns: Json
      }
      admin_get_outreach_stats: { Args: never; Returns: Json }
      admin_get_player_funnel: { Args: { p_days?: number }; Returns: Json }
      admin_get_preference_summary: { Args: never; Returns: Json }
      admin_get_preference_users: {
        Args: {
          p_enabled?: boolean
          p_limit?: number
          p_offset?: number
          p_preference: string
          p_role?: string
          p_search?: string
        }
        Returns: Json
      }
      admin_get_profile_completeness_distribution: {
        Args: { p_role?: string }
        Returns: {
          bucket: string
          count: number
          percentage: number
        }[]
      }
      admin_get_profile_details: {
        Args: { p_profile_id: string }
        Returns: Json
      }
      admin_get_profile_orphans: {
        Args: never
        Returns: {
          created_at: string
          email: string
          full_name: string
          profile_id: string
          role: string
        }[]
      }
      admin_get_reference_metrics: {
        Args: { p_days?: number; p_exclude_test?: boolean; p_role?: string }
        Returns: Json
      }
      admin_get_reports: {
        Args: {
          p_category?: string
          p_limit?: number
          p_offset?: number
          p_status?: string
        }
        Returns: {
          category: string
          content_id: string
          content_type: string
          created_at: string
          id: string
          reason: string
          reporter_avatar: string
          reporter_id: string
          reporter_name: string
          reviewed_at: string
          reviewed_by: string
          reviewer_name: string
          status: string
          target_avatar: string
          target_id: string
          target_name: string
          target_role: string
          total_count: number
        }[]
      }
      admin_get_retention_by_role: {
        Args: { p_cohort_weeks?: number; p_exclude_test?: boolean }
        Returns: Json
      }
      admin_get_retention_cohorts: {
        Args: { p_months?: number }
        Returns: {
          cohort_size: number
          d1_pct: number
          d14_pct: number
          d30_pct: number
          d7_pct: number
          signup_month: string
        }[]
      }
      admin_get_search_quality: {
        Args: { p_days?: number; p_exclude_test?: boolean }
        Returns: Json
      }
      admin_get_signup_trends: {
        Args: { p_days?: number }
        Returns: {
          brands: number
          clubs: number
          coaches: number
          date: string
          players: number
          total_signups: number
        }[]
      }
      admin_get_top_countries: {
        Args: { p_limit?: number }
        Returns: {
          country: string
          user_count: number
        }[]
      }
      admin_get_user_email_history: {
        Args: { p_limit?: number; p_offset?: number; p_user_id: string }
        Returns: Json[]
      }
      admin_get_user_engagement: {
        Args: {
          p_days?: number
          p_limit?: number
          p_offset?: number
          p_sort_by?: string
          p_sort_dir?: string
        }
        Returns: {
          active_days: number
          avatar_url: string
          avg_session_minutes: number
          display_name: string
          email: string
          last_active_at: string
          role: string
          total_count: number
          total_sessions: number
          total_time_minutes: number
          user_id: string
        }[]
      }
      admin_get_user_engagement_detail: {
        Args: { p_days?: number; p_user_id: string }
        Returns: Json
      }
      admin_get_user_growth_chart: {
        Args: { p_days?: number }
        Returns: {
          cumulative_total: number
          day: string
          new_users: number
        }[]
      }
      admin_list_investor_tokens: {
        Args: never
        Returns: {
          access_count: number
          created_at: string
          expires_at: string
          id: string
          is_active: boolean
          last_accessed_at: string
          name: string
          revoked_at: string
          token: string
        }[]
      }
      admin_log_action: {
        Args: {
          p_action: string
          p_metadata?: Json
          p_new_data?: Json
          p_old_data?: Json
          p_target_id: string
          p_target_type: string
        }
        Returns: string
      }
      admin_preview_campaign_audience: {
        Args: { p_audience_filter?: Json; p_category?: string }
        Returns: Json
      }
      admin_preview_outreach_audience: {
        Args: { p_audience_filter?: Json }
        Returns: Json
      }
      admin_resolve_country_mapping: {
        Args: { p_country_id: number; p_field: string; p_profile_id: string }
        Returns: undefined
      }
      admin_resolve_report: {
        Args: {
          p_admin_note?: string
          p_new_status: string
          p_report_id: string
        }
        Returns: undefined
      }
      admin_revoke_investor_token: {
        Args: { p_token_id: string }
        Returns: boolean
      }
      admin_rollback_email_template: {
        Args: { p_template_id: string; p_version_number: number }
        Returns: undefined
      }
      admin_save_email_template_draft: {
        Args: {
          p_change_note?: string
          p_content_json: Json
          p_subject: string
          p_template_id: string
          p_text?: string
          p_variables?: Json
        }
        Returns: Json
      }
      admin_search_profiles:
        | {
            Args: {
              p_country?: string
              p_is_blocked?: boolean
              p_is_test?: boolean
              p_limit?: number
              p_offset?: number
              p_query?: string
              p_role?: string
              p_sort?: string
            }
            Returns: {
              avatar_url: string
              country: string
              created_at: string
              email: string
              full_name: string
              id: string
              is_blocked: boolean
              is_platform_admin: boolean
              is_test_account: boolean
              onboarding_completed: boolean
              role: string
              total_count: number
              username: string
            }[]
          }
        | {
            Args: {
              p_is_blocked?: boolean
              p_is_test_account?: boolean
              p_limit?: number
              p_offset?: number
              p_onboarding_completed?: boolean
              p_query?: string
              p_role?: string
            }
            Returns: {
              avatar_url: string
              base_location: string
              created_at: string
              email: string
              full_name: string
              id: string
              is_blocked: boolean
              is_test_account: boolean
              is_verified: boolean
              nationality: string
              nationality2: string
              onboarding_completed: boolean
              role: string
              total_count: number
              updated_at: string
              username: string
            }[]
          }
      admin_set_profile_verified: {
        Args: {
          p_notes?: string
          p_profile_id: string
          p_source_url?: string
          p_value: boolean
        }
        Returns: Json
      }
      admin_set_test_account: {
        Args: { p_is_test: boolean; p_profile_id: string }
        Returns: Json
      }
      admin_toggle_email_template_active: {
        Args: { p_is_active: boolean; p_template_id: string }
        Returns: undefined
      }
      admin_unblock_user: { Args: { p_profile_id: string }; Returns: Json }
      admin_update_campaign_status:
        | {
            Args: {
              p_campaign_id: string
              p_sent_count?: number
              p_status: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_campaign_id: string
              p_sent_count?: number
              p_status: string
              p_total_recipients?: number
            }
            Returns: undefined
          }
      admin_update_email_campaign:
        | {
            Args: {
              p_audience_filter?: Json
              p_audience_source?: string
              p_campaign_id: string
              p_category?: string
              p_name?: string
              p_template_id?: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_ab_variants?: Json
              p_audience_filter?: Json
              p_audience_source?: string
              p_campaign_id: string
              p_category?: string
              p_name?: string
              p_template_id?: string
            }
            Returns: Json
          }
      admin_update_email_template_name: {
        Args: { p_name: string; p_template_id: string }
        Returns: undefined
      }
      admin_update_profile: {
        Args: { p_profile_id: string; p_reason?: string; p_updates: Json }
        Returns: Json
      }
      archive_old_messages: {
        Args: { p_batch?: number; p_retention_days?: number }
        Returns: number
      }
      block_user: { Args: { p_blocked_id: string }; Returns: undefined }
      check_application_rate_limit: {
        Args: { p_user_id: string }
        Returns: Json
      }
      check_brand_follow_status: { Args: { p_brand_id: string }; Returns: Json }
      check_login_rate_limit: { Args: { p_email: string }; Returns: Json }
      check_message_rate_limit: { Args: { p_user_id: string }; Returns: Json }
      check_password_reset_rate_limit: {
        Args: { p_email: string }
        Returns: Json
      }
      check_rate_limit: {
        Args: {
          p_action_type: string
          p_identifier: string
          p_max_requests?: number
          p_window_seconds?: number
        }
        Returns: Json
      }
      check_signup_rate_limit: { Args: { p_email: string }; Returns: Json }
      check_user_post_rate_limit: { Args: { p_user_id: string }; Returns: Json }
      claim_world_club: {
        Args: {
          p_men_league_id?: number
          p_profile_id: string
          p_women_league_id?: number
          p_world_club_id: string
        }
        Returns: Json
      }
      cleanup_rate_limits: {
        Args: { p_max_age_hours?: number }
        Returns: number
      }
      cleanup_stale_locks: { Args: never; Returns: undefined }
      clear_profile_notifications: {
        Args: {
          p_kind?: Database["public"]["Enums"]["profile_notification_kind"]
          p_notification_ids?: string[]
        }
        Returns: number
      }
      club_has_applicant: {
        Args: { p_club_id: string; p_player_id: string }
        Returns: boolean
      }
      complete_user_profile: {
        Args: {
          p_base_location: string
          p_bio?: string
          p_club_bio?: string
          p_club_history?: string
          p_contact_email?: string
          p_current_club?: string
          p_date_of_birth?: string
          p_full_name: string
          p_gender?: string
          p_highlight_video_url?: string
          p_league_division?: string
          p_nationality: string
          p_position?: string
          p_role: string
          p_secondary_position?: string
          p_user_id: string
          p_website?: string
          p_year_founded?: number
        }
        Returns: {
          accepted_friend_count: number
          accepted_reference_count: number
          avatar_url: string | null
          base_city: string | null
          base_country_id: number | null
          base_location: string | null
          bio: string | null
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          brand_representation: string | null
          browse_anonymously: boolean
          career_entry_count: number
          club_bio: string | null
          club_history: string | null
          coach_specialization: string | null
          coach_specialization_custom: string | null
          contact_email: string | null
          contact_email_public: boolean
          created_at: string
          current_club: string | null
          current_world_club_id: string | null
          date_of_birth: string | null
          email: string
          federation: string | null
          full_name: string | null
          gender: string | null
          highlight_video_url: string | null
          highlight_visibility: string
          id: string
          is_blocked: boolean
          is_test_account: boolean
          is_verified: boolean
          languages: string[] | null
          last_active_at: string | null
          last_message_email_at: string | null
          last_officiated_at: string | null
          last_platform: string | null
          last_profile_view_email_at: string | null
          league_division: string | null
          mens_league_division: string | null
          mens_league_id: number | null
          nationality: string | null
          nationality_country_id: number | null
          nationality2_country_id: number | null
          notify_applications: boolean
          notify_friends: boolean
          notify_messages: boolean
          notify_opportunities: boolean
          notify_profile_views: boolean
          notify_push: boolean
          notify_references: boolean
          officiating_specialization: string | null
          onboarding_completed: boolean
          onboarding_completed_at: string | null
          onboarding_started_at: string | null
          open_to_coach: boolean
          open_to_opportunities: boolean
          open_to_play: boolean
          position: string | null
          post_count: number
          role: string
          search_vector: unknown
          secondary_position: string | null
          social_links: Json | null
          umpire_appointment_count: number
          umpire_level: string | null
          umpire_since: number | null
          updated_at: string
          username: string | null
          verified_at: string | null
          verified_by: string | null
          version: number
          website: string | null
          womens_league_division: string | null
          womens_league_id: number | null
          world_region_id: number | null
          year_founded: number | null
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      content_check: { Args: { p_text: string }; Returns: string }
      create_and_claim_world_club: {
        Args: {
          p_club_name: string
          p_country_id: number
          p_men_league_id?: number
          p_profile_id?: string
          p_province_id?: number
          p_women_league_id?: number
        }
        Returns: Json
      }
      create_brand: {
        Args: {
          p_bio?: string
          p_category: string
          p_instagram_url?: string
          p_logo_url?: string
          p_name: string
          p_slug: string
          p_website_url?: string
        }
        Returns: Json
      }
      create_brand_post: {
        Args: { p_brand_id: string; p_content: string; p_image_url?: string }
        Returns: Json
      }
      create_brand_product: {
        Args: {
          p_brand_id: string
          p_description?: string
          p_external_url?: string
          p_images?: Json
          p_name: string
        }
        Returns: Json
      }
      create_post_comment: {
        Args: { p_content: string; p_post_id: string }
        Returns: Json
      }
      create_profile_for_new_user: {
        Args: { user_email: string; user_id: string; user_role?: string }
        Returns: {
          accepted_friend_count: number
          accepted_reference_count: number
          avatar_url: string | null
          base_city: string | null
          base_country_id: number | null
          base_location: string | null
          bio: string | null
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          brand_representation: string | null
          browse_anonymously: boolean
          career_entry_count: number
          club_bio: string | null
          club_history: string | null
          coach_specialization: string | null
          coach_specialization_custom: string | null
          contact_email: string | null
          contact_email_public: boolean
          created_at: string
          current_club: string | null
          current_world_club_id: string | null
          date_of_birth: string | null
          email: string
          federation: string | null
          full_name: string | null
          gender: string | null
          highlight_video_url: string | null
          highlight_visibility: string
          id: string
          is_blocked: boolean
          is_test_account: boolean
          is_verified: boolean
          languages: string[] | null
          last_active_at: string | null
          last_message_email_at: string | null
          last_officiated_at: string | null
          last_platform: string | null
          last_profile_view_email_at: string | null
          league_division: string | null
          mens_league_division: string | null
          mens_league_id: number | null
          nationality: string | null
          nationality_country_id: number | null
          nationality2_country_id: number | null
          notify_applications: boolean
          notify_friends: boolean
          notify_messages: boolean
          notify_opportunities: boolean
          notify_profile_views: boolean
          notify_push: boolean
          notify_references: boolean
          officiating_specialization: string | null
          onboarding_completed: boolean
          onboarding_completed_at: string | null
          onboarding_started_at: string | null
          open_to_coach: boolean
          open_to_opportunities: boolean
          open_to_play: boolean
          position: string | null
          post_count: number
          role: string
          search_vector: unknown
          secondary_position: string | null
          social_links: Json | null
          umpire_appointment_count: number
          umpire_level: string | null
          umpire_since: number | null
          updated_at: string
          username: string | null
          verified_at: string | null
          verified_by: string | null
          version: number
          website: string | null
          womens_league_division: string | null
          womens_league_id: number | null
          world_region_id: number | null
          year_founded: number | null
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_signing_post: {
        Args: {
          p_content?: string
          p_images?: Json
          p_person_profile_id: string
        }
        Returns: Json
      }
      create_transfer_post: {
        Args: {
          p_club_avatar_url?: string
          p_club_country_id?: number
          p_club_name: string
          p_content?: string
          p_images?: Json
          p_world_club_id?: string
        }
        Returns: Json
      }
      create_user_post: {
        Args: { p_content: string; p_images?: Json }
        Returns: Json
      }
      create_world_club_from_career: {
        Args: {
          p_club_name: string
          p_country_id: number
          p_province_id?: number
        }
        Returns: Json
      }
      current_profile_role: { Args: never; Returns: string }
      delete_brand_post: { Args: { p_post_id: string }; Returns: Json }
      delete_brand_product: { Args: { p_product_id: string }; Returns: Json }
      delete_post_comment: { Args: { p_comment_id: string }; Returns: Json }
      delete_rows_where_clause: {
        Args: {
          p_batch?: number
          p_table: unknown
          p_user_id: string
          p_where_sql: string
        }
        Returns: number
      }
      delete_user_post: { Args: { p_post_id: string }; Returns: Json }
      discover_profiles:
        | {
            Args: {
              p_availability?: string
              p_base_country_ids?: number[]
              p_base_location?: string
              p_country_ids?: number[]
              p_eu_passport?: boolean
              p_gender?: string
              p_league_ids?: number[]
              p_limit?: number
              p_max_age?: number
              p_min_age?: number
              p_min_career_entries?: number
              p_min_references?: number
              p_nationality_country_ids?: number[]
              p_offset?: number
              p_positions?: string[]
              p_roles?: string[]
              p_search_text?: string
              p_sort_by?: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_availability?: string
              p_base_country_ids?: number[]
              p_base_location?: string
              p_coach_specializations?: string[]
              p_country_ids?: number[]
              p_eu_passport?: boolean
              p_gender?: string
              p_league_ids?: number[]
              p_limit?: number
              p_max_age?: number
              p_min_age?: number
              p_min_career_entries?: number
              p_min_references?: number
              p_nationality_country_ids?: number[]
              p_offset?: number
              p_positions?: string[]
              p_roles?: string[]
              p_search_text?: string
              p_sort_by?: string
            }
            Returns: Json
          }
      edit_endorsement: {
        Args: { p_endorsement: string; p_reference_id: string }
        Returns: {
          accepted_at: string | null
          created_at: string
          endorsement_text: string | null
          id: string
          reference_id: string
          relationship_type: string
          request_note: string | null
          requester_id: string
          responded_at: string | null
          revoked_at: string | null
          revoked_by: string | null
          status: Database["public"]["Enums"]["profile_reference_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profile_references"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      engagement_heartbeat_interval_seconds: { Args: never; Returns: number }
      enqueue_message_digests: { Args: never; Returns: undefined }
      enqueue_notification: {
        Args: {
          p_actor_profile_id: string
          p_kind: Database["public"]["Enums"]["profile_notification_kind"]
          p_metadata?: Json
          p_recipient_profile_id: string
          p_source_entity_id?: string
          p_target_url?: string
        }
        Returns: string
      }
      enqueue_onboarding_reminders: { Args: never; Returns: undefined }
      enqueue_orphaned_storage_objects: {
        Args: { p_limit?: number; p_min_age?: string }
        Returns: number
      }
      enqueue_profile_view_emails: { Args: never; Returns: undefined }
      enqueue_storage_objects_for_prefix: {
        Args: { p_bucket: string; p_prefix: string; p_reason?: string }
        Returns: number
      }
      escape_ilike: { Args: { input: string }; Returns: string }
      extract_storage_path: {
        Args: { p_bucket: string; p_url: string }
        Returns: string
      }
      fetch_club_opportunities_with_counts: {
        Args: {
          p_club_id: string
          p_include_closed?: boolean
          p_limit?: number
        }
        Returns: {
          applicant_count: number
          application_deadline: string
          benefits: string[]
          closed_at: string
          club_id: string
          contact_email: string
          contact_phone: string
          created_at: string
          custom_benefits: string[]
          description: string
          duration_text: string
          gender: Database["public"]["Enums"]["opportunity_gender"]
          id: string
          location_city: string
          location_country: string
          opportunity_type: Database["public"]["Enums"]["opportunity_type"]
          organization_name: string
          pending_count: number
          position: Database["public"]["Enums"]["opportunity_position"]
          priority: Database["public"]["Enums"]["opportunity_priority"]
          published_at: string
          requirements: string[]
          start_date: string
          status: Database["public"]["Enums"]["opportunity_status"]
          title: string
          updated_at: string
          version: number
        }[]
      }
      fetch_club_vacancies_with_counts: {
        Args: {
          p_club_id: string
          p_include_closed?: boolean
          p_limit?: number
        }
        Returns: {
          applicant_count: number
          application_deadline: string
          benefits: string[]
          closed_at: string
          club_id: string
          contact_email: string
          contact_phone: string
          created_at: string
          custom_benefits: string[]
          description: string
          duration_text: string
          gender: Database["public"]["Enums"]["opportunity_gender"]
          id: string
          location_city: string
          location_country: string
          opportunity_type: Database["public"]["Enums"]["opportunity_type"]
          position: Database["public"]["Enums"]["opportunity_position"]
          priority: Database["public"]["Enums"]["opportunity_priority"]
          published_at: string
          requirements: string[]
          start_date: string
          status: Database["public"]["Enums"]["opportunity_status"]
          title: string
          updated_at: string
          version: number
        }[]
      }
      find_zombie_accounts: {
        Args: never
        Returns: {
          created_at: string
          email: string
          email_confirmed_at: string
          intended_role: string
          profile_complete: boolean
          profile_exists: boolean
          user_id: string
        }[]
      }
      follow_brand: { Args: { p_brand_id: string }; Returns: Json }
      generate_brand_slug: { Args: { p_name: string }; Returns: string }
      get_brand_ambassadors: {
        Args: {
          p_brand_id: string
          p_limit?: number
          p_offset?: number
          p_status?: string
        }
        Returns: Json
      }
      get_brand_ambassadors_public: {
        Args: { p_brand_id: string; p_limit?: number }
        Returns: Json
      }
      get_brand_by_slug: { Args: { p_slug: string }; Returns: Json }
      get_brand_feed: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: Json
      }
      get_brand_followers: {
        Args: { p_brand_id: string; p_limit?: number; p_offset?: number }
        Returns: Json
      }
      get_brand_posts: { Args: { p_brand_id: string }; Returns: Json }
      get_brand_products: { Args: { p_brand_id: string }; Returns: Json }
      get_brands: {
        Args: {
          p_category?: string
          p_limit?: number
          p_offset?: number
          p_search?: string
        }
        Returns: Json
      }
      get_club_members: {
        Args: { p_limit?: number; p_offset?: number; p_profile_id: string }
        Returns: {
          avatar_url: string
          base_location: string
          created_at: string
          current_club: string
          current_world_club_id: string
          full_name: string
          id: string
          is_test_account: boolean
          nationality: string
          nationality_country_id: number
          nationality2_country_id: number
          open_to_coach: boolean
          open_to_play: boolean
          position: string
          role: string
          secondary_position: string
          total_count: number
        }[]
      }
      get_home_feed: {
        Args: { p_item_type?: string; p_limit?: number; p_offset?: number }
        Returns: Json
      }
      get_home_feed_new_count: { Args: { p_since: string }; Returns: number }
      get_leagues_for_location: {
        Args: { p_country_id: number; p_region_id?: number }
        Returns: {
          id: number
          logical_id: string
          name: string
          tier: number
        }[]
      }
      get_message_recipient: {
        Args: { p_conversation_id: string; p_sender_id: string }
        Returns: string
      }
      get_my_ambassador_invitations: { Args: never; Returns: Json }
      get_my_brand: { Args: never; Returns: Json }
      get_my_brand_analytics: { Args: { p_days?: number }; Returns: Json }
      get_my_profile_view_stats: { Args: { p_days?: number }; Returns: Json }
      get_my_profile_viewers: {
        Args: { p_days?: number; p_limit?: number }
        Returns: {
          avatar_url: string
          base_location: string
          brand_slug: string
          full_name: string
          role: string
          username: string
          view_count: number
          viewed_at: string
          viewer_id: string
        }[]
      }
      get_my_reference_requests: {
        Args: never
        Returns: {
          created_at: string
          id: string
          reference_id: string
          relationship_type: string
          request_note: string
          requester_id: string
          requester_profile: Json
          status: Database["public"]["Enums"]["profile_reference_status"]
        }[]
      }
      get_my_references: {
        Args: never
        Returns: {
          accepted_at: string
          created_at: string
          endorsement_text: string
          id: string
          reference_id: string
          reference_profile: Json
          relationship_type: string
          request_note: string
          requester_id: string
          responded_at: string
          status: Database["public"]["Enums"]["profile_reference_status"]
        }[]
      }
      get_notification_counts: {
        Args: never
        Returns: {
          total_count: number
          unread_count: number
        }[]
      }
      get_notifications: {
        Args: {
          p_filter?: string
          p_kind?: Database["public"]["Enums"]["profile_notification_kind"]
          p_limit?: number
          p_offset?: number
        }
        Returns: {
          actor: Json
          cleared_at: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["profile_notification_kind"]
          metadata: Json
          read_at: string
          seen_at: string
          source_entity_id: string
          target_url: string
        }[]
      }
      get_opportunity_alerts: { Args: never; Returns: number }
      get_post_comments: {
        Args: { p_limit?: number; p_offset?: number; p_post_id: string }
        Returns: Json
      }
      get_profile_posts: {
        Args: { p_limit?: number; p_offset?: number; p_profile_id: string }
        Returns: Json
      }
      get_profile_references: {
        Args: { p_profile_id: string }
        Returns: {
          accepted_at: string
          endorsement_text: string
          id: string
          reference_id: string
          reference_profile: Json
          relationship_type: string
          requester_id: string
        }[]
      }
      get_profile_search_appearances: {
        Args: { p_days?: number; p_profile_id: string }
        Returns: {
          appearances: number
          day: string
        }[]
      }
      get_references_i_gave: {
        Args: never
        Returns: {
          accepted_at: string
          endorsement_text: string
          id: string
          reference_id: string
          relationship_type: string
          requester_id: string
          requester_profile: Json
          status: Database["public"]["Enums"]["profile_reference_status"]
        }[]
      }
      get_user_conversations: {
        Args: {
          p_cursor_conversation_id?: string
          p_cursor_last_message_at?: string
          p_limit?: number
          p_user_id: string
        }
        Returns: {
          conversation_created_at: string
          conversation_id: string
          conversation_last_message_at: string
          conversation_updated_at: string
          has_more: boolean
          last_message_content: string
          last_message_sender_id: string
          last_message_sent_at: string
          other_participant_avatar: string
          other_participant_id: string
          other_participant_name: string
          other_participant_role: string
          other_participant_username: string
          unread_count: number
        }[]
      }
      hard_delete_profile_relations: {
        Args: { p_batch?: number; p_user_id: string }
        Returns: Json
      }
      has_accepted_terms: { Args: { p_version?: string }; Returns: boolean }
      health_check: { Args: never; Returns: boolean }
      is_blocked_pair: {
        Args: { p_user_a: string; p_user_b: string }
        Returns: boolean
      }
      is_current_user_test_account: { Args: never; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      is_test_opportunity: {
        Args: { opportunity_club_id: string }
        Returns: boolean
      }
      is_user_blocked: { Args: { p_other_id: string }; Returns: boolean }
      leave_brand_ambassadorship: {
        Args: { p_brand_ambassador_id: string }
        Returns: Json
      }
      log_error: {
        Args: {
          p_correlation_id?: string
          p_error_code?: string
          p_error_message: string
          p_error_type: string
          p_function_name?: string
          p_metadata?: Json
          p_severity?: string
          p_source: string
          p_stack_trace?: string
        }
        Returns: string
      }
      mark_all_notifications_read: {
        Args: {
          p_kind?: Database["public"]["Enums"]["profile_notification_kind"]
        }
        Returns: number
      }
      mark_conversation_messages_read: {
        Args: { p_before?: string; p_conversation_id: string }
        Returns: number
      }
      mark_notification_read: {
        Args: { p_notification_id: string }
        Returns: boolean
      }
      mark_opportunities_seen: {
        Args: { p_seen_at?: string }
        Returns: undefined
      }
      match_text_to_country: {
        Args: { input_text: string }
        Returns: {
          confidence: string
          country_id: number
          match_type: string
        }[]
      }
      outreach_status_priority: { Args: { p_status: string }; Returns: number }
      process_storage_cleanup_queue: {
        Args: { p_batch?: number; p_grace_period?: string }
        Returns: number
      }
      prune_old_heartbeats: {
        Args: { p_days_to_keep?: number }
        Returns: number
      }
      prune_old_logs: { Args: never; Returns: undefined }
      prune_profile_notifications: {
        Args: {
          p_batch?: number
          p_cleared_days?: number
          p_visible_days?: number
        }
        Returns: number
      }
      public_get_investor_metrics: {
        Args: { p_days?: number; p_token: string }
        Returns: Json
      }
      public_get_investor_signup_trends: {
        Args: { p_days?: number; p_token: string }
        Returns: {
          clubs: number
          coaches: number
          cumulative_total: number
          date: string
          players: number
          total_signups: number
        }[]
      }
      record_engagement_heartbeat: {
        Args: { p_session_id: string }
        Returns: Json
      }
      record_milestone: {
        Args: {
          p_is_test_account: boolean
          p_metadata: Json
          p_milestone_type: string
          p_profile_id: string
        }
        Returns: boolean
      }
      recover_zombie_accounts: {
        Args: never
        Returns: {
          action_taken: string
          user_id: string
        }[]
      }
      release_profile_lock: { Args: { profile_id: string }; Returns: boolean }
      remove_brand_ambassador: {
        Args: { p_brand_id: string; p_player_id: string }
        Returns: Json
      }
      remove_reference: {
        Args: { p_reference_id: string }
        Returns: {
          accepted_at: string | null
          created_at: string
          endorsement_text: string | null
          id: string
          reference_id: string
          relationship_type: string
          request_note: string | null
          requester_id: string
          responded_at: string | null
          revoked_at: string | null
          revoked_by: string | null
          status: Database["public"]["Enums"]["profile_reference_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profile_references"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      report_user: {
        Args: {
          p_category?: string
          p_content_id?: string
          p_content_type?: string
          p_reason: string
          p_target_id: string
        }
        Returns: string
      }
      request_reference: {
        Args: {
          p_reference_id: string
          p_relationship_type: string
          p_request_note?: string
        }
        Returns: {
          accepted_at: string | null
          created_at: string
          endorsement_text: string | null
          id: string
          reference_id: string
          relationship_type: string
          request_note: string | null
          requester_id: string
          responded_at: string | null
          revoked_at: string | null
          revoked_by: string | null
          status: Database["public"]["Enums"]["profile_reference_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profile_references"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      respond_reference: {
        Args: {
          p_accept: boolean
          p_endorsement?: string
          p_reference_id: string
        }
        Returns: {
          accepted_at: string | null
          created_at: string
          endorsement_text: string | null
          id: string
          reference_id: string
          relationship_type: string
          request_note: string | null
          requester_id: string
          responded_at: string | null
          revoked_at: string | null
          revoked_by: string | null
          status: Database["public"]["Enums"]["profile_reference_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profile_references"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      respond_to_ambassador_request: {
        Args: { p_accept: boolean; p_brand_ambassador_id: string }
        Returns: Json
      }
      search_clubs_for_transfer: {
        Args: { p_limit?: number; p_query: string }
        Returns: Json
      }
      search_content: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_query: string
          p_type?: string
        }
        Returns: Json
      }
      search_people_for_signing: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          avatar_url: string
          base_location: string
          current_club: string
          full_name: string
          id: string
          position: string
          role: string
        }[]
      }
      search_world_clubs: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          avatar_url: string
          club_name: string
          club_name_normalized: string
          country_code: string
          country_id: number
          country_name: string
          flag_emoji: string
          id: string
          is_claimed: boolean
          men_league_id: number
          men_league_name: string
          men_league_tier: number
          province_id: number
          province_name: string
          province_slug: string
          women_league_id: number
          women_league_name: string
          women_league_tier: number
        }[]
      }
      send_profile_view_notifications: {
        Args: { p_batch?: number; p_min_views?: number }
        Returns: number
      }
      set_profile_comment_status: {
        Args: {
          p_comment_id: string
          p_status: Database["public"]["Enums"]["comment_status"]
        }
        Returns: {
          author_profile_id: string
          content: string
          created_at: string
          id: string
          profile_id: string
          rating: Database["public"]["Enums"]["comment_rating"] | null
          status: Database["public"]["Enums"]["comment_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profile_comments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      toggle_post_like: { Args: { p_post_id: string }; Returns: Json }
      track_event: {
        Args: {
          p_entity_id?: string
          p_entity_type?: string
          p_error_code?: string
          p_error_message?: string
          p_event_name: string
          p_properties?: Json
        }
        Returns: string
      }
      track_user_device: {
        Args: { p_is_pwa?: boolean; p_platform: string; p_user_agent?: string }
        Returns: undefined
      }
      try_parse_years_component: {
        Args: { component: string; years: string }
        Returns: string
      }
      unblock_user: { Args: { p_blocked_id: string }; Returns: undefined }
      unfollow_brand: { Args: { p_brand_id: string }; Returns: Json }
      update_brand: {
        Args: {
          p_bio?: string
          p_category?: string
          p_instagram_url?: string
          p_logo_url?: string
          p_name?: string
          p_website_url?: string
        }
        Returns: Json
      }
      update_brand_post: {
        Args: { p_content?: string; p_image_url?: string; p_post_id: string }
        Returns: Json
      }
      update_brand_product: {
        Args: {
          p_description?: string
          p_external_url?: string
          p_images?: Json
          p_name?: string
          p_product_id: string
        }
        Returns: Json
      }
      update_user_post: {
        Args: { p_content: string; p_images?: Json; p_post_id: string }
        Returns: Json
      }
      user_in_conversation: {
        Args: { p_conversation_id: string; p_user_id: string }
        Returns: boolean
      }
      validate_social_links: { Args: { links: Json }; Returns: boolean }
      withdraw_reference: {
        Args: { p_reference_id: string }
        Returns: {
          accepted_at: string | null
          created_at: string
          endorsement_text: string | null
          id: string
          reference_id: string
          relationship_type: string
          request_note: string | null
          requester_id: string
          responded_at: string | null
          revoked_at: string | null
          revoked_by: string | null
          status: Database["public"]["Enums"]["profile_reference_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profile_references"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      application_status: "pending" | "shortlisted" | "maybe" | "rejected"
      comment_rating: "positive" | "neutral" | "negative"
      comment_status: "visible" | "hidden" | "reported" | "deleted"
      friendship_status:
        | "pending"
        | "accepted"
        | "rejected"
        | "cancelled"
        | "blocked"
      journey_entry_type:
        | "club"
        | "national_team"
        | "achievement"
        | "tournament"
        | "milestone"
        | "academy"
        | "other"
      opportunity_gender: "Men" | "Women"
      opportunity_position:
        | "goalkeeper"
        | "defender"
        | "midfielder"
        | "forward"
        | "head_coach"
        | "assistant_coach"
        | "youth_coach"
        | "goalkeeper_coach"
        | "strength_conditioning"
        | "performance_analyst"
        | "sports_scientist"
        | "other_coach"
      opportunity_priority: "low" | "medium" | "high"
      opportunity_status: "draft" | "open" | "closed"
      opportunity_type: "player" | "coach"
      profile_notification_kind:
        | "friend_request_received"
        | "profile_comment_created"
        | "reference_request_received"
        | "reference_request_accepted"
        | "friend_request_accepted"
        | "reference_updated"
        | "profile_comment_reply"
        | "profile_comment_like"
        | "message_received"
        | "conversation_started"
        | "vacancy_application_received"
        | "vacancy_application_status"
        | "profile_completed"
        | "account_verified"
        | "system_announcement"
        | "reference_request_rejected"
        | "opportunity_published"
        | "ambassador_request_received"
        | "ambassador_request_accepted"
        | "profile_viewed"
        | "user_post_comment_received"
      profile_reference_status: "pending" | "accepted" | "declined" | "revoked"
      question_category:
        | "trials_club_selection"
        | "visas_moving_abroad"
        | "scholarships_universities"
        | "highlights_visibility"
        | "training_performance"
        | "coaching_development"
        | "lifestyle_adaptation"
        | "other"
      umpire_journey_entry_type:
        | "appointment"
        | "milestone"
        | "certification"
        | "panel"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      application_status: ["pending", "shortlisted", "maybe", "rejected"],
      comment_rating: ["positive", "neutral", "negative"],
      comment_status: ["visible", "hidden", "reported", "deleted"],
      friendship_status: [
        "pending",
        "accepted",
        "rejected",
        "cancelled",
        "blocked",
      ],
      journey_entry_type: [
        "club",
        "national_team",
        "achievement",
        "tournament",
        "milestone",
        "academy",
        "other",
      ],
      opportunity_gender: ["Men", "Women"],
      opportunity_position: [
        "goalkeeper",
        "defender",
        "midfielder",
        "forward",
        "head_coach",
        "assistant_coach",
        "youth_coach",
        "goalkeeper_coach",
        "strength_conditioning",
        "performance_analyst",
        "sports_scientist",
        "other_coach",
      ],
      opportunity_priority: ["low", "medium", "high"],
      opportunity_status: ["draft", "open", "closed"],
      opportunity_type: ["player", "coach"],
      profile_notification_kind: [
        "friend_request_received",
        "profile_comment_created",
        "reference_request_received",
        "reference_request_accepted",
        "friend_request_accepted",
        "reference_updated",
        "profile_comment_reply",
        "profile_comment_like",
        "message_received",
        "conversation_started",
        "vacancy_application_received",
        "vacancy_application_status",
        "profile_completed",
        "account_verified",
        "system_announcement",
        "reference_request_rejected",
        "opportunity_published",
        "ambassador_request_received",
        "ambassador_request_accepted",
        "profile_viewed",
        "user_post_comment_received",
      ],
      profile_reference_status: ["pending", "accepted", "declined", "revoked"],
      question_category: [
        "trials_club_selection",
        "visas_moving_abroad",
        "scholarships_universities",
        "highlights_visibility",
        "training_performance",
        "coaching_development",
        "lifestyle_adaptation",
        "other",
      ],
      umpire_journey_entry_type: [
        "appointment",
        "milestone",
        "certification",
        "panel",
      ],
    },
  },
} as const
