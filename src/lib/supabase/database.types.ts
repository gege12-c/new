export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      admin_users: {
        Row: {
          created_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      athlete_events: {
        Row: {
          athlete_id: string;
          created_at: string;
          created_by: string | null;
          distance_label: string | null;
          event_date: string;
          id: string;
          location: string | null;
          name: string;
          notes: string | null;
          priority: string;
          sport: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          athlete_id: string;
          created_at?: string;
          created_by?: string | null;
          distance_label?: string | null;
          event_date: string;
          id?: string;
          location?: string | null;
          name: string;
          notes?: string | null;
          priority?: string;
          sport?: string;
          updated_at?: string;
        };
        Update: {
          athlete_id?: string;
          created_at?: string;
          created_by?: string | null;
          distance_label?: string | null;
          event_date?: string;
          id?: string;
          location?: string | null;
          name?: string;
          notes?: string | null;
          priority?: string;
          sport?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "athlete_events_athlete_id_fkey";
            columns: ["athlete_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "athlete_events_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      athlete_profiles: {
        Row: {
          created_at: string;
          experience_level: string | null;
          main_goal: string | null;
          notes: string | null;
          updated_at: string;
          user_id: string;
          weekly_hours_target: number | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          experience_level?: string | null;
          main_goal?: string | null;
          notes?: string | null;
          updated_at?: string;
          user_id: string;
          weekly_hours_target?: number | null;
        };
        Update: {
          created_at?: string;
          experience_level?: string | null;
          main_goal?: string | null;
          notes?: string | null;
          updated_at?: string;
          user_id?: string;
          weekly_hours_target?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "athlete_profiles_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      athlete_thresholds: {
        Row: {
          athlete_id: string;
          created_at: string;
          created_by: string | null;
          effective_from: string;
          id: string;
          metric: string;
          notes: string | null;
          source: string;
          sport: string;
          updated_at: string;
          value: number;
        };
        ComputedFields: never;
        Insert: {
          athlete_id: string;
          created_at?: string;
          created_by?: string | null;
          effective_from: string;
          id?: string;
          metric: string;
          notes?: string | null;
          source?: string;
          sport: string;
          updated_at?: string;
          value: number;
        };
        Update: {
          athlete_id?: string;
          created_at?: string;
          created_by?: string | null;
          effective_from?: string;
          id?: string;
          metric?: string;
          notes?: string | null;
          source?: string;
          sport?: string;
          updated_at?: string;
          value?: number;
        };
        Relationships: [
          {
            foreignKeyName: "athlete_thresholds_athlete_id_fkey";
            columns: ["athlete_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "athlete_thresholds_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_logs: {
        Row: {
          action: string;
          actor_id: string | null;
          athlete_id: string | null;
          changes: NonNullable<Json>;
          entity_id: string;
          entity_type: string;
          id: number;
          occurred_at: string;
          visibility: string;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_id?: string | null;
          athlete_id?: string | null;
          changes?: NonNullable<Json>;
          entity_id: string;
          entity_type: string;
          id?: never;
          occurred_at?: string;
          visibility?: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          athlete_id?: string | null;
          changes?: NonNullable<Json>;
          entity_id?: string;
          entity_type?: string;
          id?: never;
          occurred_at?: string;
          visibility?: string;
        };
        Relationships: [];
      };
      coach_athlete_links: {
        Row: {
          athlete_id: string;
          can_edit_plan: boolean;
          can_view_activities: boolean;
          coach_id: string;
          created_at: string;
          id: string;
          revoked_at: string | null;
          revoked_by: string | null;
          status: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          athlete_id: string;
          can_edit_plan?: boolean;
          can_view_activities?: boolean;
          coach_id: string;
          created_at?: string;
          id?: string;
          revoked_at?: string | null;
          revoked_by?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          athlete_id?: string;
          can_edit_plan?: boolean;
          can_view_activities?: boolean;
          coach_id?: string;
          created_at?: string;
          id?: string;
          revoked_at?: string | null;
          revoked_by?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "coach_athlete_links_athlete_id_fkey";
            columns: ["athlete_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coach_athlete_links_coach_id_fkey";
            columns: ["coach_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coach_athlete_links_revoked_by_fkey";
            columns: ["revoked_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      invitations: {
        Row: {
          accepted_at: string | null;
          accepted_by: string | null;
          coach_id: string;
          created_at: string;
          email: string | null;
          expires_at: string;
          id: string;
          revoked_at: string | null;
          token_hash: string;
        };
        ComputedFields: never;
        Insert: {
          accepted_at?: string | null;
          accepted_by?: string | null;
          coach_id: string;
          created_at?: string;
          email?: string | null;
          expires_at: string;
          id?: string;
          revoked_at?: string | null;
          token_hash: string;
        };
        Update: {
          accepted_at?: string | null;
          accepted_by?: string | null;
          coach_id?: string;
          created_at?: string;
          email?: string | null;
          expires_at?: string;
          id?: string;
          revoked_at?: string | null;
          token_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invitations_accepted_by_fkey";
            columns: ["accepted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invitations_coach_id_fkey";
            columns: ["coach_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      planned_session_drafts: {
        Row: {
          athlete_id: string;
          base: NonNullable<Json>;
          created_at: string;
          payload: NonNullable<Json>;
          session_id: string;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          athlete_id: string;
          base: NonNullable<Json>;
          created_at?: string;
          payload: NonNullable<Json>;
          session_id: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          athlete_id?: string;
          base?: NonNullable<Json>;
          created_at?: string;
          payload?: NonNullable<Json>;
          session_id?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "planned_session_drafts_athlete_id_fkey";
            columns: ["athlete_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planned_session_drafts_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: true;
            referencedRelation: "planned_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planned_session_drafts_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      planned_sessions: {
        Row: {
          athlete_id: string;
          content: NonNullable<Json>;
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          nutrition_notes: string | null;
          objective: string | null;
          planned_distance_m: number | null;
          planned_duration_s: number | null;
          published_at: string | null;
          scheduled_date: string;
          sport: string;
          start_time: string | null;
          state: string;
          template_id: string | null;
          title: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          athlete_id: string;
          content: NonNullable<Json>;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          nutrition_notes?: string | null;
          objective?: string | null;
          planned_distance_m?: number | null;
          planned_duration_s?: number | null;
          published_at?: string | null;
          scheduled_date: string;
          sport: string;
          start_time?: string | null;
          state?: string;
          template_id?: string | null;
          title: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          athlete_id?: string;
          content?: NonNullable<Json>;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          nutrition_notes?: string | null;
          objective?: string | null;
          planned_distance_m?: number | null;
          planned_duration_s?: number | null;
          published_at?: string | null;
          scheduled_date?: string;
          sport?: string;
          start_time?: string | null;
          state?: string;
          template_id?: string | null;
          title?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "planned_sessions_athlete_id_fkey";
            columns: ["athlete_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planned_sessions_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planned_sessions_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "workout_templates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planned_sessions_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string;
          id: string;
          is_coach: boolean;
          timezone: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          display_name: string;
          id: string;
          is_coach?: boolean;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_name?: string;
          id?: string;
          is_coach?: boolean;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      session_comments: {
        Row: {
          athlete_id: string;
          author_id: string;
          body: string;
          created_at: string;
          edited_at: string | null;
          id: string;
          session_id: string;
          visibility: string;
        };
        ComputedFields: never;
        Insert: {
          athlete_id: string;
          author_id?: string;
          body: string;
          created_at?: string;
          edited_at?: string | null;
          id?: string;
          session_id: string;
          visibility?: string;
        };
        Update: {
          athlete_id?: string;
          author_id?: string;
          body?: string;
          created_at?: string;
          edited_at?: string | null;
          id?: string;
          session_id?: string;
          visibility?: string;
        };
        Relationships: [
          {
            foreignKeyName: "session_comments_athlete_id_fkey";
            columns: ["athlete_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "session_comments_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "session_comments_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "planned_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      workout_templates: {
        Row: {
          archived_at: string | null;
          content: NonNullable<Json>;
          created_at: string;
          description: string | null;
          id: string;
          name: string;
          objective: string | null;
          owner_id: string;
          planned_distance_m: number | null;
          planned_duration_s: number | null;
          sport: string;
          tags: string[];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          archived_at?: string | null;
          content: NonNullable<Json>;
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
          objective?: string | null;
          owner_id?: string;
          planned_distance_m?: number | null;
          planned_duration_s?: number | null;
          sport: string;
          tags?: string[];
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          content?: NonNullable<Json>;
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
          objective?: string | null;
          owner_id?: string;
          planned_distance_m?: number | null;
          planned_duration_s?: number | null;
          sport?: string;
          tags?: string[];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workout_templates_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_invitation: { Args: { p_token: string }; Returns: string };
      athlete_thresholds_at: {
        Args: { p_athlete: string; p_date: string };
        Returns: {
          effective_from: string;
          metric: string;
          sport: string;
          value: number;
        }[];
      };
      copy_planned_week: {
        Args: { p_athlete: string; p_from: string; p_state?: string; p_to: string };
        Returns: number;
      };
      create_invitation: {
        Args: { p_email?: string; p_valid_hours?: number };
        Returns: {
          expires_at: string;
          invitation_id: string;
          token: string;
        }[];
      };
      current_user_is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      duplicate_planned_session: { Args: { p_date: string; p_session: string }; Returns: string };
      get_invitation_preview: {
        Args: { p_token: string };
        Returns: {
          coach_name: string;
          email_bound: boolean;
          expires_at: string;
          status: string;
        }[];
      };
      publish_session_draft: { Args: { p_prefer?: string; p_session: string }; Returns: Json };
      rebase_session_draft: { Args: { p_prefer: string; p_session: string }; Returns: Json };
      revoke_coach_link: { Args: { p_link_id: string }; Returns: undefined };
      revoke_invitation: { Args: { p_invitation_id: string }; Returns: undefined };
      save_planned_session: {
        Args: { p_base: Json; p_session: string; p_values: Json };
        Returns: Json;
      };
      save_session_draft: {
        Args: { p_base: Json; p_payload: Json; p_session: string };
        Returns: Json;
      };
      set_coach_permissions: {
        Args: { p_can_edit_plan: boolean; p_can_view_activities: boolean; p_link_id: string };
        Returns: undefined;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
