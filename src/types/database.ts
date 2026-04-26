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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      backtest_runs: {
        Row: {
          asset_type: Database["public"]["Enums"]["asset_type_enum"]
          avg_abs_delta: number | null
          created_at: string
          date_from: string
          date_to: string
          days_above_5pp: number
          days_missing_inputs: number
          days_with_replay: number
          duration_ms: number
          id: string
          max_abs_delta: number | null
          model_version: string
          request_hash: string
          request_json: Json
          total_days: number
          user_id: string
          user_weights_id: string | null
          weights_version: string
        }
        Insert: {
          asset_type: Database["public"]["Enums"]["asset_type_enum"]
          avg_abs_delta?: number | null
          created_at?: string
          date_from: string
          date_to: string
          days_above_5pp: number
          days_missing_inputs: number
          days_with_replay: number
          duration_ms: number
          id?: string
          max_abs_delta?: number | null
          model_version: string
          request_hash: string
          request_json: Json
          total_days: number
          user_id: string
          user_weights_id?: string | null
          weights_version: string
        }
        Update: {
          asset_type?: Database["public"]["Enums"]["asset_type_enum"]
          avg_abs_delta?: number | null
          created_at?: string
          date_from?: string
          date_to?: string
          days_above_5pp?: number
          days_missing_inputs?: number
          days_with_replay?: number
          duration_ms?: number
          id?: string
          max_abs_delta?: number | null
          model_version?: string
          request_hash?: string
          request_json?: Json
          total_days?: number
          user_id?: string
          user_weights_id?: string | null
          weights_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "backtest_runs_user_weights_id_fkey"
            columns: ["user_weights_id"]
            isOneToOne: false
            referencedRelation: "user_weights"
            referencedColumns: ["id"]
          },
        ]
      }
      backtest_snapshots: {
        Row: {
          contributing: Json | null
          delta: number | null
          gaps: string[] | null
          id: string
          original_model_version: string | null
          original_score: number | null
          raw_inputs: Json | null
          replay_band: string | null
          replay_score: number | null
          run_id: string
          signal_state: Json | null
          snapshot_date: string
        }
        Insert: {
          contributing?: Json | null
          delta?: number | null
          gaps?: string[] | null
          id?: string
          original_model_version?: string | null
          original_score?: number | null
          raw_inputs?: Json | null
          replay_band?: string | null
          replay_score?: number | null
          run_id: string
          signal_state?: Json | null
          snapshot_date: string
        }
        Update: {
          contributing?: Json | null
          delta?: number | null
          gaps?: string[] | null
          id?: string
          original_model_version?: string | null
          original_score?: number | null
          raw_inputs?: Json | null
          replay_band?: string | null
          replay_score?: number | null
          run_id?: string
          signal_state?: Json | null
          snapshot_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "backtest_snapshots_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "backtest_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      composite_snapshots: {
        Row: {
          asset_type: Database["public"]["Enums"]["asset_type_enum"]
          band: string
          contributing_indicators: Json
          created_at: string
          fetch_status: Database["public"]["Enums"]["fetch_status_enum"]
          id: string
          model_version: string
          regime_confidence: number | null
          regime_features: Json | null
          regime_label: string | null
          score_0_100: number
          snapshot_date: string
        }
        Insert: {
          asset_type: Database["public"]["Enums"]["asset_type_enum"]
          band: string
          contributing_indicators: Json
          created_at?: string
          fetch_status?: Database["public"]["Enums"]["fetch_status_enum"]
          id?: string
          model_version: string
          regime_confidence?: number | null
          regime_features?: Json | null
          regime_label?: string | null
          score_0_100: number
          snapshot_date: string
        }
        Update: {
          asset_type?: Database["public"]["Enums"]["asset_type_enum"]
          band?: string
          contributing_indicators?: Json
          created_at?: string
          fetch_status?: Database["public"]["Enums"]["fetch_status_enum"]
          id?: string
          model_version?: string
          regime_confidence?: number | null
          regime_features?: Json | null
          regime_label?: string | null
          score_0_100?: number
          snapshot_date?: string
        }
        Relationships: []
      }
      ecos_readings: {
        Row: {
          fetch_status: Database["public"]["Enums"]["fetch_status_enum"]
          id: string
          ingested_at: string
          item_code: string | null
          model_version: string
          observed_at: string
          raw_payload: Json | null
          score_0_100: number | null
          series_code: string
          source_name: string
          value_normalized: number | null
          value_raw: number | null
        }
        Insert: {
          fetch_status?: Database["public"]["Enums"]["fetch_status_enum"]
          id?: string
          ingested_at?: string
          item_code?: string | null
          model_version: string
          observed_at: string
          raw_payload?: Json | null
          score_0_100?: number | null
          series_code: string
          source_name?: string
          value_normalized?: number | null
          value_raw?: number | null
        }
        Update: {
          fetch_status?: Database["public"]["Enums"]["fetch_status_enum"]
          id?: string
          ingested_at?: string
          item_code?: string | null
          model_version?: string
          observed_at?: string
          raw_payload?: Json | null
          score_0_100?: number | null
          series_code?: string
          source_name?: string
          value_normalized?: number | null
          value_raw?: number | null
        }
        Relationships: []
      }
      indicator_readings: {
        Row: {
          asset_type: Database["public"]["Enums"]["asset_type_enum"]
          fetch_status: Database["public"]["Enums"]["fetch_status_enum"]
          frequency: string | null
          id: string
          indicator_key: string
          ingested_at: string
          is_revised: boolean
          model_version: string
          observed_at: string
          raw_payload: Json | null
          released_at: string | null
          score_0_100: number | null
          source_name: string
          source_url: string | null
          value_normalized: number | null
          value_raw: number | null
          window_used: string | null
        }
        Insert: {
          asset_type?: Database["public"]["Enums"]["asset_type_enum"]
          fetch_status?: Database["public"]["Enums"]["fetch_status_enum"]
          frequency?: string | null
          id?: string
          indicator_key: string
          ingested_at?: string
          is_revised?: boolean
          model_version: string
          observed_at: string
          raw_payload?: Json | null
          released_at?: string | null
          score_0_100?: number | null
          source_name: string
          source_url?: string | null
          value_normalized?: number | null
          value_raw?: number | null
          window_used?: string | null
        }
        Update: {
          asset_type?: Database["public"]["Enums"]["asset_type_enum"]
          fetch_status?: Database["public"]["Enums"]["fetch_status_enum"]
          frequency?: string | null
          id?: string
          indicator_key?: string
          ingested_at?: string
          is_revised?: boolean
          model_version?: string
          observed_at?: string
          raw_payload?: Json | null
          released_at?: string | null
          score_0_100?: number | null
          source_name?: string
          source_url?: string | null
          value_normalized?: number | null
          value_raw?: number | null
          window_used?: string | null
        }
        Relationships: []
      }
      ingest_runs: {
        Row: {
          duration_ms: number | null
          error_summary: string | null
          id: string
          indicators_attempted: number
          indicators_failed: number
          indicators_success: number
          model_version: string
          run_at: string
          snapshots_written: number
        }
        Insert: {
          duration_ms?: number | null
          error_summary?: string | null
          id?: string
          indicators_attempted?: number
          indicators_failed?: number
          indicators_success?: number
          model_version: string
          run_at?: string
          snapshots_written?: number
        }
        Update: {
          duration_ms?: number | null
          error_summary?: string | null
          id?: string
          indicators_attempted?: number
          indicators_failed?: number
          indicators_success?: number
          model_version?: string
          run_at?: string
          snapshots_written?: number
        }
        Relationships: []
      }
      model_version_history: {
        Row: {
          created_at: string
          cutover_date: string
          model_version: string
          notes: string | null
        }
        Insert: {
          created_at?: string
          cutover_date: string
          model_version: string
          notes?: string | null
        }
        Update: {
          created_at?: string
          cutover_date?: string
          model_version?: string
          notes?: string | null
        }
        Relationships: []
      }
      news_sentiment: {
        Row: {
          article_count: number
          asset_type: Database["public"]["Enums"]["asset_type_enum"]
          fetch_status: Database["public"]["Enums"]["fetch_status_enum"]
          id: string
          ingested_at: string
          model_version: string
          observed_at: string
          raw_payload: Json | null
          score_0_100: number
          source_name: string
          ticker: string | null
        }
        Insert: {
          article_count?: number
          asset_type: Database["public"]["Enums"]["asset_type_enum"]
          fetch_status?: Database["public"]["Enums"]["fetch_status_enum"]
          id?: string
          ingested_at?: string
          model_version: string
          observed_at: string
          raw_payload?: Json | null
          score_0_100: number
          source_name: string
          ticker?: string | null
        }
        Update: {
          article_count?: number
          asset_type?: Database["public"]["Enums"]["asset_type_enum"]
          fetch_status?: Database["public"]["Enums"]["fetch_status_enum"]
          id?: string
          ingested_at?: string
          model_version?: string
          observed_at?: string
          raw_payload?: Json | null
          score_0_100?: number
          source_name?: string
          ticker?: string | null
        }
        Relationships: []
      }
      onchain_readings: {
        Row: {
          asset_type: Database["public"]["Enums"]["asset_type_enum"]
          fetch_status: Database["public"]["Enums"]["fetch_status_enum"]
          id: string
          indicator_key: string
          ingested_at: string
          model_version: string
          observed_at: string
          raw_payload: Json | null
          score_0_100: number | null
          source_name: string
          value_normalized: number | null
          value_raw: number | null
        }
        Insert: {
          asset_type: Database["public"]["Enums"]["asset_type_enum"]
          fetch_status?: Database["public"]["Enums"]["fetch_status_enum"]
          id?: string
          indicator_key: string
          ingested_at?: string
          model_version: string
          observed_at: string
          raw_payload?: Json | null
          score_0_100?: number | null
          source_name: string
          value_normalized?: number | null
          value_raw?: number | null
        }
        Update: {
          asset_type?: Database["public"]["Enums"]["asset_type_enum"]
          fetch_status?: Database["public"]["Enums"]["fetch_status_enum"]
          id?: string
          indicator_key?: string
          ingested_at?: string
          model_version?: string
          observed_at?: string
          raw_payload?: Json | null
          score_0_100?: number | null
          source_name?: string
          value_normalized?: number | null
          value_raw?: number | null
        }
        Relationships: []
      }
      price_readings: {
        Row: {
          asset_type: Database["public"]["Enums"]["asset_type_enum"]
          close: number
          high: number | null
          id: string
          ingested_at: string
          low: number | null
          open: number | null
          price_date: string
          source_name: string
          ticker: string
          volume: number | null
        }
        Insert: {
          asset_type: Database["public"]["Enums"]["asset_type_enum"]
          close: number
          high?: number | null
          id?: string
          ingested_at?: string
          low?: number | null
          open?: number | null
          price_date: string
          source_name: string
          ticker: string
          volume?: number | null
        }
        Update: {
          asset_type?: Database["public"]["Enums"]["asset_type_enum"]
          close?: number
          high?: number | null
          id?: string
          ingested_at?: string
          low?: number | null
          open?: number | null
          price_date?: string
          source_name?: string
          ticker?: string
          volume?: number | null
        }
        Relationships: []
      }
      score_changelog: {
        Row: {
          asset_type: Database["public"]["Enums"]["asset_type_enum"]
          band_changed: boolean
          change_date: string
          created_at: string
          current_band: string
          current_score: number
          delta: number | null
          id: string
          model_version: string
          previous_band: string | null
          previous_score: number | null
          top_movers: Json | null
        }
        Insert: {
          asset_type: Database["public"]["Enums"]["asset_type_enum"]
          band_changed?: boolean
          change_date: string
          created_at?: string
          current_band: string
          current_score: number
          delta?: number | null
          id?: string
          model_version: string
          previous_band?: string | null
          previous_score?: number | null
          top_movers?: Json | null
        }
        Update: {
          asset_type?: Database["public"]["Enums"]["asset_type_enum"]
          band_changed?: boolean
          change_date?: string
          created_at?: string
          current_band?: string
          current_score?: number
          delta?: number | null
          id?: string
          model_version?: string
          previous_band?: string | null
          previous_score?: number | null
          top_movers?: Json | null
        }
        Relationships: []
      }
      signal_events: {
        Row: {
          active_signals: Json
          alignment_count: number
          computed_at: string
          per_signal_detail: Json
          signal_rules_version: string
          snapshot_date: string
        }
        Insert: {
          active_signals: Json
          alignment_count: number
          computed_at?: string
          per_signal_detail: Json
          signal_rules_version: string
          snapshot_date: string
        }
        Update: {
          active_signals?: Json
          alignment_count?: number
          computed_at?: string
          per_signal_detail?: Json
          signal_rules_version?: string
          snapshot_date?: string
        }
        Relationships: []
      }
      technical_readings: {
        Row: {
          asset_type: Database["public"]["Enums"]["asset_type_enum"]
          fetch_status: Database["public"]["Enums"]["fetch_status_enum"]
          id: string
          indicator_key: string
          ingested_at: string
          model_version: string
          observed_at: string
          raw_payload: Json | null
          score_0_100: number | null
          source_name: string
          ticker: string
          value_normalized: number | null
          value_raw: number | null
        }
        Insert: {
          asset_type: Database["public"]["Enums"]["asset_type_enum"]
          fetch_status?: Database["public"]["Enums"]["fetch_status_enum"]
          id?: string
          indicator_key: string
          ingested_at?: string
          model_version: string
          observed_at: string
          raw_payload?: Json | null
          score_0_100?: number | null
          source_name: string
          ticker: string
          value_normalized?: number | null
          value_raw?: number | null
        }
        Update: {
          asset_type?: Database["public"]["Enums"]["asset_type_enum"]
          fetch_status?: Database["public"]["Enums"]["fetch_status_enum"]
          id?: string
          indicator_key?: string
          ingested_at?: string
          model_version?: string
          observed_at?: string
          raw_payload?: Json | null
          score_0_100?: number | null
          source_name?: string
          ticker?: string
          value_normalized?: number | null
          value_raw?: number | null
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          persona: string
          updated_at: string
          user_id: string
        }
        Insert: {
          persona?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          persona?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_weights: {
        Row: {
          created_at: string
          description_ko: string | null
          id: string
          name: string
          payload: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          description_ko?: string | null
          id?: string
          name: string
          payload: Json
          user_id: string
        }
        Update: {
          created_at?: string
          description_ko?: string | null
          id?: string
          name?: string
          payload?: Json
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      asset_type_enum:
        | "us_equity"
        | "kr_equity"
        | "crypto"
        | "global_etf"
        | "common"
      fetch_status_enum: "success" | "error" | "stale" | "partial"
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
      asset_type_enum: [
        "us_equity",
        "kr_equity",
        "crypto",
        "global_etf",
        "common",
      ],
      fetch_status_enum: ["success", "error", "stale", "partial"],
    },
  },
} as const
