CREATE TABLE "desktop_auth_request" (
	"id" text PRIMARY KEY NOT NULL,
	"callback_url" text NOT NULL,
	"code_challenge" text NOT NULL,
	"code_hash" text,
	"user_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "desktop_auth_request" ADD CONSTRAINT "desktop_auth_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "desktop_auth_request_expiry_idx" ON "desktop_auth_request" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "desktop_auth_request_user_idx" ON "desktop_auth_request" USING btree ("user_id");