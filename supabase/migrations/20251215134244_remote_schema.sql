


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."installment_status" AS ENUM (
    'Due',
    'Paid',
    'Partially Paid',
    'Overdue'
);


ALTER TYPE "public"."installment_status" OWNER TO "postgres";


CREATE TYPE "public"."ticket_priority" AS ENUM (
    'Low',
    'Medium',
    'High'
);


ALTER TYPE "public"."ticket_priority" OWNER TO "postgres";


CREATE TYPE "public"."ticket_status" AS ENUM (
    'Open',
    'In Progress',
    'Resolved'
);


ALTER TYPE "public"."ticket_status" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'admin',
    'faculty'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_payment_to_installments"("p_payment_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_admission_id UUID;
    v_payment_amount NUMERIC;
    v_remaining_payment_amount NUMERIC;
    r_installment RECORD;
BEGIN
    SELECT admission_id, amount_paid
    INTO v_admission_id, v_payment_amount
    FROM public.payments
    WHERE id = p_payment_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'Payment ID % not found', p_payment_id; END IF;

    v_remaining_payment_amount := v_payment_amount;

    FOR r_installment IN
        SELECT id, amount, status
        FROM public.installments
        WHERE admission_id = v_admission_id AND status IN ('Pending', 'Overdue')
        ORDER BY due_date ASC
    LOOP
        IF v_remaining_payment_amount <= 0 THEN EXIT; END IF;

        DECLARE v_installment_due NUMERIC := r_installment.amount; -- Simplification
        BEGIN
            IF v_remaining_payment_amount >= v_installment_due THEN
                UPDATE public.installments SET status = 'Paid' WHERE id = r_installment.id;
                v_remaining_payment_amount := v_remaining_payment_amount - v_installment_due;
            ELSE
                 UPDATE public.installments SET status = 'Pending' WHERE id = r_installment.id;
                v_remaining_payment_amount := 0;
            END IF;
        END;
    END LOOP;
END;
$$;


ALTER FUNCTION "public"."apply_payment_to_installments"("p_payment_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_assignee_is_admin"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$ DECLARE assignee_role public.user_role; BEGIN IF NEW.assignee_id IS NULL THEN RETURN NEW; END IF; SELECT role INTO assignee_role FROM public.users WHERE id = NEW.assignee_id; IF assignee_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Assignee Error: User with ID % is not an admin.', NEW.assignee_id; END IF; RETURN NEW; END; $$;


ALTER FUNCTION "public"."check_assignee_is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_admission_and_student"("p_student_name" "text", "p_student_phone_number" "text", "p_father_name" "text", "p_father_phone_number" "text", "p_permanent_address" "text", "p_current_address" "text", "p_address_proof_id_number" "text", "p_remarks" "text", "p_certificate_id" "uuid", "p_discount" numeric, "p_course_ids" "uuid"[], "p_installments" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_student_id UUID;
  new_admission_id UUID;
  v_base_tuition_fees NUMERIC;
  v_book_fees NUMERIC;
  v_gst_rate NUMERIC;
  v_subtotal NUMERIC;
  v_gst_amount NUMERIC;
  v_total_invoice_amount NUMERIC;
  v_final_payable_amount NUMERIC;
  course_id UUID;
  installment RECORD;
BEGIN
  -- 1. Find or create the master student record based on phone number.
  SELECT id INTO v_student_id FROM public.students WHERE phone_number = p_student_phone_number;

  IF NOT FOUND THEN
    INSERT INTO public.students (name, phone_number, admission_number)
    VALUES (p_student_name, p_student_phone_number, 'ADM-' || upper(substr(md5(random()::text), 0, 8)))
    RETURNING id INTO v_student_id;
  END IF;

  -- 2. Fetch GST rate and perform all financial calculations.
  SELECT (value->>'rate')::NUMERIC INTO v_gst_rate FROM public.system_settings WHERE key = 'gst_rate';
  IF NOT FOUND THEN RAISE EXCEPTION 'GST rate not configured in system_settings table.'; END IF;

  SELECT COALESCE(SUM(price), 0) INTO v_base_tuition_fees FROM public.courses WHERE id = ANY(p_course_ids);
  SELECT COALESCE(SUM(b.price), 0) INTO v_book_fees FROM public.books b JOIN public.course_books cb ON b.id = cb.book_id WHERE cb.course_id = ANY(p_course_ids);

  v_subtotal := v_base_tuition_fees + v_book_fees;
  v_gst_amount := v_base_tuition_fees * v_gst_rate;
  v_total_invoice_amount := v_subtotal + v_gst_amount;
  v_final_payable_amount := GREATEST(0, v_subtotal - COALESCE(p_discount, 0)) + v_gst_amount;

  -- 3. Create the admission, now storing the detailed student info directly within it.
  INSERT INTO public.admissions (
      student_id, -- Link to master student record
      -- Admission-specific student details
      student_name, student_phone_number, father_name, father_phone_number, permanent_address, current_address, address_proof_id_number, remarks,
      -- Financial Breakdown
      certificate_id, base_tuition_fees, book_fees, subtotal, gst_amount, total_invoice_amount, discount, final_payable_amount
  )
  VALUES (
      v_student_id,
      -- Admission-specific student details
      p_student_name, p_student_phone_number, p_father_name, p_father_phone_number, p_permanent_address, p_current_address, p_address_proof_id_number, p_remarks,
      -- Financial Breakdown
      p_certificate_id, v_base_tuition_fees, v_book_fees, v_subtotal, v_gst_amount, v_total_invoice_amount, COALESCE(p_discount, 0), v_final_payable_amount
  )
  RETURNING id INTO new_admission_id;

  -- 4. Link courses and create installment plan (no changes here).
  IF p_course_ids IS NOT NULL THEN FOREACH course_id IN ARRAY p_course_ids LOOP INSERT INTO public.admission_courses (admission_id, course_id) VALUES (new_admission_id, course_id); END LOOP; END IF;
  IF p_installments IS NOT NULL THEN FOR installment IN SELECT * FROM jsonb_to_recordset(p_installments) AS x(due_date DATE, amount NUMERIC) LOOP INSERT INTO public.fee_installments (admission_id, due_date, amount_due) VALUES (new_admission_id, installment.due_date, installment.amount); END LOOP; END IF;

  RETURN new_admission_id;
END;
$$;


ALTER FUNCTION "public"."create_admission_and_student"("p_student_name" "text", "p_student_phone_number" "text", "p_father_name" "text", "p_father_phone_number" "text", "p_permanent_address" "text", "p_current_address" "text", "p_address_proof_id_number" "text", "p_remarks" "text", "p_certificate_id" "uuid", "p_discount" numeric, "p_course_ids" "uuid"[], "p_installments" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_admission_and_student"("p_student_name" "text", "p_student_phone_number" "text", "p_father_name" "text", "p_father_phone_number" "text", "p_permanent_address" "text", "p_current_address" "text", "p_address_proof_id_number" "text", "p_remarks" "text", "p_certificate_id" "uuid", "p_total_fees" numeric, "p_discount" numeric, "p_courses" "uuid"[], "p_installments" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql"
    AS $$
DECLARE new_student_id UUID; new_admission_id UUID; v_final_fees NUMERIC; course_id UUID; installment RECORD;
BEGIN
  v_final_fees := p_total_fees - COALESCE(p_discount, 0);
  INSERT INTO public.students (name, phone_number, father_name, father_phone_number, permanent_address, current_address, address_proof_id_number, remarks, admission_number) VALUES (p_student_name, p_student_phone_number, p_father_name, p_father_phone_number, p_permanent_address, p_current_address, p_address_proof_id_number, p_remarks, 'ADM-' || upper(substr(md5(random()::text), 0, 8))) RETURNING id INTO new_student_id;
  INSERT INTO public.admissions (student_id, certificate_id, total_fees, discount, final_fees) VALUES (new_student_id, p_certificate_id, p_total_fees, p_discount, v_final_fees) RETURNING id INTO new_admission_id;
  IF p_courses IS NOT NULL THEN FOREACH course_id IN ARRAY p_courses LOOP INSERT INTO public.admission_courses (admission_id, course_id) VALUES (new_admission_id, course_id); END LOOP; END IF;
  IF p_installments IS NOT NULL THEN FOR installment IN SELECT * FROM jsonb_to_recordset(p_installments) AS x(due_date DATE, amount NUMERIC) LOOP INSERT INTO public.fee_installments (admission_id, due_date, amount_due) VALUES (new_admission_id, installment.due_date, installment.amount); END LOOP; END IF;
  RETURN new_admission_id;
END;
$$;


ALTER FUNCTION "public"."create_admission_and_student"("p_student_name" "text", "p_student_phone_number" "text", "p_father_name" "text", "p_father_phone_number" "text", "p_permanent_address" "text", "p_current_address" "text", "p_address_proof_id_number" "text", "p_remarks" "text", "p_certificate_id" "uuid", "p_total_fees" numeric, "p_discount" numeric, "p_courses" "uuid"[], "p_installments" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_admission_and_student"("p_student_name" "text", "p_student_phone_number" "text", "p_father_name" "text", "p_father_phone_number" "text", "p_permanent_address" "text", "p_current_address" "text", "p_identification_type" "text", "p_identification_number" "text", "p_date_of_admission" "date", "p_course_start_date" "date", "p_batch_preference" "text", "p_remarks" "text", "p_certificate_id" "uuid", "p_discount" numeric, "p_course_ids" "uuid"[], "p_installments" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_student_id UUID;
  v_admission_id UUID;
  v_course_id UUID;
  v_installment JSONB;
  
  v_total_course_price NUMERIC;
  v_certificate_cost NUMERIC;
  v_base_amount NUMERIC;
  v_final_payable_amount NUMERIC;
  v_admission_number TEXT; 
  
BEGIN
  
  -- 1. Check for duplicate phone number
  IF EXISTS (SELECT 1 FROM public.students WHERE phone_number = p_student_phone_number) THEN
    RAISE EXCEPTION 'Student with phone number % already exists.', p_student_phone_number;
  END IF;

  -- 2. Create Student
  v_admission_number := 'RVM-' || EXTRACT(YEAR FROM NOW()) || '-' || 
                        lpad(nextval('admission_number_seq')::text, 4, '0');

  INSERT INTO public.students (name, phone_number, admission_number)
  VALUES (p_student_name, p_student_phone_number, v_admission_number)
  RETURNING id INTO v_student_id;

  -- 3. Financial Calcs
  SELECT COALESCE(SUM(price), 0) INTO v_total_course_price
  FROM public.courses WHERE id = ANY(p_course_ids);

  SELECT COALESCE(cost, 0) INTO v_certificate_cost
  FROM public.certificates WHERE id = p_certificate_id;

  v_base_amount := v_total_course_price + v_certificate_cost;
  v_final_payable_amount := (v_base_amount - p_discount);

  -- 4. Create Admission (AUTO-APPROVED)
  INSERT INTO public.admissions (
    student_id, certificate_id, base_amount, subtotal, total_invoice_amount,
    discount, final_payable_amount, 
    remarks, date_of_admission, course_start_date, batch_preference,
    father_name, father_phone_number, permanent_address, current_address,
    identification_type, identification_number,
    student_name, student_phone_number,
    total_payable_amount,
    
    -- === AUTO-APPROVAL FIELDS ===
    approval_status,
    is_gst_exempt,
    gst_rate
  )
  VALUES (
    v_student_id, p_certificate_id, v_base_amount, v_base_amount, v_base_amount,
    p_discount, v_final_payable_amount, 
    p_remarks, p_date_of_admission, p_course_start_date, p_batch_preference,
    p_father_name, p_father_phone_number, p_permanent_address, p_current_address,
    p_identification_type, p_identification_number,
    p_student_name, p_student_phone_number,
    v_final_payable_amount, -- Set total payable immediately
    
    -- === AUTO-APPROVAL VALUES ===
    'Approved', -- Automatically Approved
    true,       -- GST Exempt
    0           -- 0% Rate
  )
  RETURNING id INTO v_admission_id;

  -- 5. Link Courses
  FOREACH v_course_id IN ARRAY p_course_ids
  LOOP
    INSERT INTO public.admission_courses (admission_id, course_id)
    VALUES (v_admission_id, v_course_id);
  END LOOP;

  -- 6. Create Installments
  FOR v_installment IN SELECT * FROM jsonb_array_elements(p_installments)
  LOOP
    INSERT INTO public.installments (
      admission_id, due_date, amount, status
    )
    VALUES (
      v_admission_id,
      (v_installment->>'due_date')::DATE,
      (v_installment->>'amount')::NUMERIC,
      'Pending'
    );
  END LOOP;

  RETURN v_admission_id;

END;
$$;


ALTER FUNCTION "public"."create_admission_and_student"("p_student_name" "text", "p_student_phone_number" "text", "p_father_name" "text", "p_father_phone_number" "text", "p_permanent_address" "text", "p_current_address" "text", "p_identification_type" "text", "p_identification_number" "text", "p_date_of_admission" "date", "p_course_start_date" "date", "p_batch_preference" "text", "p_remarks" "text", "p_certificate_id" "uuid", "p_discount" numeric, "p_course_ids" "uuid"[], "p_installments" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_course_with_books"("p_name" "text", "p_price" numeric, "p_book_ids" "uuid"[]) RETURNS "uuid"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  new_course_id UUID;
  book_id UUID;
BEGIN
  -- Insert the new course and get its ID
  INSERT INTO public.courses (name, price)
  VALUES (p_name, p_price)
  RETURNING id INTO new_course_id;

  -- If book IDs are provided, loop through them and create the links
  IF array_length(p_book_ids, 1) > 0 THEN
    FOREACH book_id IN ARRAY p_book_ids
    LOOP
      INSERT INTO public.course_books (course_id, book_id)
      VALUES (new_course_id, book_id);
    END LOOP;
  END IF;

  -- Return the ID of the newly created course
  RETURN new_course_id;
END;
$$;


ALTER FUNCTION "public"."create_course_with_books"("p_name" "text", "p_price" numeric, "p_book_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_admission_dashboard"("search_term" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_metrics JSONB;
  v_admissions_list JSONB;
BEGIN
  
  -- 1. Calculate all the metrics for the cards
  SELECT jsonb_build_object(
    'totalAdmissions', (SELECT COUNT(*) FROM admissions),
    'admissionsThisMonth', (
      SELECT COUNT(*) FROM admissions
      -- THIS IS THE CORRECTED LINE:
      WHERE date_trunc('month', date_of_admission) = date_trunc('month', CURRENT_DATE)
    ),
    'totalCollected', (
      SELECT COALESCE(SUM(amount), 0) FROM installments WHERE status = 'Paid'
    ),
    'revenueCollectedThisMonth', (
      SELECT COALESCE(SUM(amount), 0) FROM installments
      WHERE status = 'Paid'
      AND date_trunc('month', due_date) = date_trunc('month', CURRENT_DATE)
    ),
    'totalOutstanding', (
      SELECT COALESCE(SUM(amount), 0) FROM installments WHERE status != 'Paid'
    ),
    'overdueCount', (
      SELECT COUNT(DISTINCT admission_id) FROM installments WHERE status = 'Overdue'
    )
  ) INTO v_metrics;
  
  -- 2. Get the list of admissions from our new view
  SELECT jsonb_agg(rows)
  INTO v_admissions_list
  FROM (
    SELECT *
    FROM v_dashboard_admissions_list
    WHERE
      search_term IS NULL OR search_term = '' OR
      student_name ILIKE ('%' || search_term || '%') OR
      student_phone_number ILIKE ('%' || search_term || '%')
    ORDER BY created_at DESC
  ) as rows;
  
  -- 3. Combine and return everything
  RETURN jsonb_build_object(
    'metrics', v_metrics,
    'admissions', COALESCE(v_admissions_list, '[]'::jsonb)
  );
  
END;
$$;


ALTER FUNCTION "public"."get_admission_dashboard"("search_term" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_unique_ticket_categories"() RETURNS TABLE("category" "text")
    LANGUAGE "plpgsql"
    AS $$ BEGIN RETURN QUERY SELECT DISTINCT t.category FROM tickets as t WHERE t.category IS NOT NULL; END; $$;


ALTER FUNCTION "public"."get_unique_ticket_categories"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_payment"("p_admission_id" "uuid", "p_amount_paid" numeric, "p_payment_date" "date", "p_payment_method" "text", "p_user_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql"
    AS $$ DECLARE new_receipt_id UUID; remaining_payment_amount NUMERIC := p_amount_paid; installment_to_pay RECORD; BEGIN INSERT INTO public.receipts (admission_id, amount_paid, payment_date, payment_method, generated_by, receipt_number) VALUES (p_admission_id, p_amount_paid, p_payment_date, p_payment_method, p_user_id, 'RCPT-' || upper(substr(md5(random()::text), 0, 10))) RETURNING id INTO new_receipt_id; FOR installment_to_pay IN SELECT id, balance_due FROM public.v_installment_status WHERE admission_id = p_admission_id AND status IN ('Overdue', 'Partially Paid', 'Due') ORDER BY due_date ASC LOOP IF remaining_payment_amount <= 0 THEN EXIT; END IF; DECLARE amount_to_apply NUMERIC; BEGIN amount_to_apply := LEAST(remaining_payment_amount, installment_to_pay.balance_due); INSERT INTO public.receipt_installments (receipt_id, installment_id, amount_applied) VALUES (new_receipt_id, installment_to_pay.id, amount_to_apply); remaining_payment_amount := remaining_payment_amount - amount_to_apply; END; END LOOP; RETURN new_receipt_id; END; $$;


ALTER FUNCTION "public"."record_payment"("p_admission_id" "uuid", "p_amount_paid" numeric, "p_payment_date" "date", "p_payment_method" "text", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."send_admin_reply_and_update_status"("p_ticket_id" "uuid", "p_sender_user_id" "uuid", "p_message" "text") RETURNS json
    LANGUAGE "plpgsql"
    AS $$ DECLARE new_message RECORD; BEGIN INSERT INTO messages (ticket_id, sender_user_id, message) VALUES (p_ticket_id, p_sender_user_id, p_message) RETURNING * INTO new_message; UPDATE tickets SET status = 'In Progress' WHERE id = p_ticket_id AND status = 'Open'; RETURN row_to_json(new_message); END; $$;


ALTER FUNCTION "public"."send_admin_reply_and_update_status"("p_ticket_id" "uuid", "p_sender_user_id" "uuid", "p_message" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_course_with_books"("p_course_id" "uuid", "p_name" "text", "p_price" numeric, "p_book_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  book_id UUID;
BEGIN
  -- Update the course details
  UPDATE public.courses
  SET name = p_name, price = p_price
  WHERE id = p_course_id;

  -- Atomically update the book links: delete all old ones first.
  DELETE FROM public.course_books WHERE course_id = p_course_id;

  -- If new book IDs are provided, insert them.
  IF array_length(p_book_ids, 1) > 0 THEN
    FOREACH book_id IN ARRAY p_book_ids
    LOOP
      INSERT INTO public.course_books (course_id, book_id)
      VALUES (p_course_id, book_id);
    END LOOP;
  END IF;
END;
$$;


ALTER FUNCTION "public"."update_course_with_books"("p_course_id" "uuid", "p_name" "text", "p_price" numeric, "p_book_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_faculty_availability"("p_availability" "jsonb", "p_faculty_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$ BEGIN DELETE FROM public.faculty_availability WHERE faculty_id = p_faculty_id; IF jsonb_array_length(p_availability) > 0 THEN INSERT INTO public.faculty_availability (faculty_id, day_of_week, start_time, end_time) SELECT p_faculty_id, (value->>'day_of_week')::text, (value->>'start_time')::time, (value->>'end_time')::time FROM jsonb_array_elements(p_availability) AS value; END IF; END; $$;


ALTER FUNCTION "public"."update_faculty_availability"("p_availability" "jsonb", "p_faculty_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."activities" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "action" character varying,
    "item" character varying,
    "user" character varying,
    "type" character varying
);


ALTER TABLE "public"."activities" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."activities_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."activities_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."activities_id_seq" OWNED BY "public"."activities"."id";



CREATE TABLE IF NOT EXISTS "public"."admin_notifications" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "application_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "message" "text" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "is_read" boolean DEFAULT false
);


ALTER TABLE "public"."admin_notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admission_courses" (
    "admission_id" "uuid" NOT NULL,
    "course_id" "uuid" NOT NULL
);


ALTER TABLE "public"."admission_courses" OWNER TO "postgres";


COMMENT ON TABLE "public"."admission_courses" IS 'Links admissions to the courses they enrolled in.';



CREATE SEQUENCE IF NOT EXISTS "public"."admission_number_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."admission_number_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "certificate_id" "uuid",
    "base_tuition_fees" numeric(10,2) DEFAULT 0 NOT NULL,
    "book_fees" numeric(10,2) DEFAULT 0 NOT NULL,
    "subtotal" numeric(10,2) NOT NULL,
    "gst_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "total_invoice_amount" numeric(10,2) NOT NULL,
    "discount" numeric(10,2) DEFAULT 0,
    "final_payable_amount" numeric(10,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "student_name" "text",
    "student_phone_number" "text",
    "father_name" "text",
    "father_phone_number" "text",
    "permanent_address" "text",
    "current_address" "text",
    "address_proof_id_number" "text",
    "remarks" "text",
    "identification_type" "text",
    "identification_number" "text",
    "base_amount" numeric,
    "total_payable_amount" numeric,
    "batch_preference" "text",
    "approval_status" "text" DEFAULT 'Pending'::"text" NOT NULL,
    "rejection_reason" "text",
    "gst_rate" numeric(5,2) DEFAULT 0.00,
    "is_gst_exempt" boolean DEFAULT false,
    "date_of_admission" "date",
    "course_start_date" "date",
    CONSTRAINT "admissions_approval_status_check" CHECK (("approval_status" = ANY (ARRAY['Pending'::"text", 'Approved'::"text", 'Rejected'::"text"])))
);


ALTER TABLE "public"."admissions" OWNER TO "postgres";


COMMENT ON TABLE "public"."admissions" IS 'Stores details about each student enrollment.';



COMMENT ON COLUMN "public"."admissions"."final_payable_amount" IS 'Calculated Base Amount minus Discount (Pre-GST if applicable).';



COMMENT ON COLUMN "public"."admissions"."student_name" IS 'Snapshot of the student''s name at the time of this admission.';



COMMENT ON COLUMN "public"."admissions"."student_phone_number" IS 'Snapshot of the student''s phone number at the time of this admission.';



COMMENT ON COLUMN "public"."admissions"."total_payable_amount" IS 'The final amount after approval, potentially including GST.';



CREATE TABLE IF NOT EXISTS "public"."announcements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "batch_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "announcements_scope_check" CHECK (("scope" = ANY (ARRAY['all'::"text", 'batch'::"text"]))),
    CONSTRAINT "scope_batch_consistency" CHECK (((("scope" = 'all'::"text") AND ("batch_id" IS NULL)) OR (("scope" = 'batch'::"text") AND ("batch_id" IS NOT NULL))))
);


ALTER TABLE "public"."announcements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."application_chats" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "application_id" "uuid",
    "sender_id" "uuid",
    "sender_student_id" "uuid",
    "message" "text" NOT NULL,
    "is_admin" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "read_by_student" boolean DEFAULT false
);


ALTER TABLE "public"."application_chats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."batch_students" (
    "batch_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL
);


ALTER TABLE "public"."batch_students" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "start_date" "date",
    "end_date" "date",
    "start_time" time without time zone,
    "end_time" time without time zone,
    "faculty_id" "uuid",
    "skill_id" "uuid",
    "max_students" integer,
    "status" "text",
    "days_of_week" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."batches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."books" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "price" numeric(10,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "books_price_check" CHECK (("price" >= (0)::numeric))
);


ALTER TABLE "public"."books" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."certificates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "cost" numeric(10,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "certificates_cost_check" CHECK (("cost" >= (0)::numeric))
);


ALTER TABLE "public"."certificates" OWNER TO "postgres";


COMMENT ON TABLE "public"."certificates" IS 'Stores certificate offerings.';



CREATE TABLE IF NOT EXISTS "public"."chat_read_status" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "application_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "last_read_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."chat_read_status" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."configuration" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key" "text" NOT NULL,
    "rate" numeric NOT NULL,
    "is_active" boolean DEFAULT true,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."configuration" OWNER TO "postgres";


COMMENT ON TABLE "public"."configuration" IS 'Stores global configuration values like tax rates.';



CREATE TABLE IF NOT EXISTS "public"."course_books" (
    "course_id" "uuid" NOT NULL,
    "book_id" "uuid" NOT NULL
);


ALTER TABLE "public"."course_books" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."courses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "price" numeric(10,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "courses_price_check" CHECK (("price" >= (0)::numeric))
);


ALTER TABLE "public"."courses" OWNER TO "postgres";


COMMENT ON TABLE "public"."courses" IS 'Stores course offerings.';



CREATE TABLE IF NOT EXISTS "public"."faculty" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "phone_number" "text",
    "employment_type" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."faculty" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."faculty_availability" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "faculty_id" "uuid" NOT NULL,
    "day_of_week" "text" NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "check_start_end_times" CHECK (("start_time" < "end_time"))
);


ALTER TABLE "public"."faculty_availability" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."faculty_skills" (
    "faculty_id" "uuid" NOT NULL,
    "skill_id" "uuid" NOT NULL
);


ALTER TABLE "public"."faculty_skills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fee_installments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admission_id" "uuid" NOT NULL,
    "due_date" "date" NOT NULL,
    "amount_due" numeric(10,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."fee_installments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."follow_ups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admission_id" "uuid" NOT NULL,
    "follow_up_date" "date" NOT NULL,
    "notes" "text",
    "user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "next_follow_up_date" "date",
    "type" "text",
    "lead_type" "text"
);


ALTER TABLE "public"."follow_ups" OWNER TO "postgres";


COMMENT ON TABLE "public"."follow_ups" IS 'Logs communication history and schedules next follow-up task.';



COMMENT ON COLUMN "public"."follow_ups"."next_follow_up_date" IS 'The date the next follow-up task is due for this admission.';



CREATE TABLE IF NOT EXISTS "public"."students" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "phone_number" "text",
    "admission_number" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "profile_data" "jsonb" DEFAULT '{}'::"jsonb",
    "linkedin_url" "text",
    "portfolio_url" "text",
    "summary" "text",
    "skills" "text"[],
    "resume_url" "text",
    "is_suspended" boolean DEFAULT false,
    "suspended_until" timestamp without time zone,
    "is_banned" boolean DEFAULT false,
    "placement_status" "text" DEFAULT 'Job Seeker'::"text"
);


ALTER TABLE "public"."students" OWNER TO "postgres";


COMMENT ON TABLE "public"."students" IS 'Stores basic student profile information.';



CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "username" "text",
    "phone_number" "text",
    "password_hash" "text" NOT NULL,
    "role" "public"."user_role",
    "faculty_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "at_least_one_login_method" CHECK ((("username" IS NOT NULL) OR ("phone_number" IS NOT NULL)))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."follow_up_details" AS
 SELECT "f"."id" AS "follow_up_id",
    "f"."created_at" AS "log_date",
    "f"."notes" AS "follow_up_notes",
    "f"."type" AS "follow_up_type",
    "f"."lead_type",
    "f"."next_follow_up_date",
    "f"."admission_id",
    "s"."id" AS "student_id",
    "s"."admission_number",
    "s"."name" AS "student_name",
    "b"."id" AS "batch_id",
    "b"."name" AS "batch_name",
    "u"."username" AS "staff_name"
   FROM ((((("public"."follow_ups" "f"
     JOIN "public"."admissions" "a" ON (("f"."admission_id" = "a"."id")))
     JOIN "public"."students" "s" ON (("a"."student_id" = "s"."id")))
     LEFT JOIN "public"."users" "u" ON (("f"."user_id" = "u"."id")))
     LEFT JOIN "public"."batch_students" "bs" ON (("s"."id" = "bs"."student_id")))
     LEFT JOIN "public"."batches" "b" ON (("bs"."batch_id" = "b"."id")));


ALTER VIEW "public"."follow_up_details" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."general_chats" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "message" "text" NOT NULL,
    "is_admin" boolean DEFAULT false,
    "read_by_student" boolean DEFAULT false,
    "read_by_admin" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."general_chats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."installments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admission_id" "uuid" NOT NULL,
    "due_date" "date" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "status" "text" DEFAULT 'Pending'::"text" NOT NULL,
    "paid_on" "date",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."installments" OWNER TO "postgres";


COMMENT ON TABLE "public"."installments" IS 'Stores the planned payment schedule for each admission.';



CREATE TABLE IF NOT EXISTS "public"."job_applications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_id" "uuid",
    "student_id" "uuid",
    "status" "text" DEFAULT 'Applied'::"text",
    "applied_at" timestamp with time zone DEFAULT "now"(),
    "rejection_reason" "text",
    "admin_remarks" "text",
    "attendance_status" "text" DEFAULT 'Pending'::"text",
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "reapply_granted" boolean DEFAULT false
);


ALTER TABLE "public"."job_applications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."job_course_eligibility" (
    "job_id" "uuid" NOT NULL,
    "course_id" "uuid" NOT NULL
);


ALTER TABLE "public"."job_course_eligibility" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "company_name" "text" NOT NULL,
    "location" "text",
    "salary_range" "text",
    "job_type" "text",
    "description" "text",
    "tags" "text"[],
    "status" "text" DEFAULT 'Open'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "interview_date" "date",
    "interview_time" time without time zone,
    "venue" "text",
    "interview_type" "text" DEFAULT 'walk_in'::"text",
    "campus_start_date" "date",
    "campus_end_date" "date",
    "max_candidates" integer,
    "required_candidates" integer DEFAULT 0,
    "eligible_courses" "text"[] DEFAULT '{}'::"text"[],
    CONSTRAINT "jobs_interview_type_check" CHECK (("interview_type" = ANY (ARRAY['walk_in'::"text", 'campus_drive'::"text"])))
);


ALTER TABLE "public"."jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ticket_id" "uuid",
    "sender_user_id" "uuid",
    "sender_student_id" "uuid",
    "message" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_one_sender" CHECK (((("sender_user_id" IS NOT NULL) AND ("sender_student_id" IS NULL)) OR (("sender_user_id" IS NULL) AND ("sender_student_id" IS NOT NULL))))
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admission_id" "uuid" NOT NULL,
    "payment_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "amount_paid" numeric(10,2) NOT NULL,
    "method" "text",
    "receipt_number" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    CONSTRAINT "payments_amount_paid_check" CHECK (("amount_paid" > (0)::numeric)),
    CONSTRAINT "payments_method_check" CHECK (("method" = ANY (ARRAY['Cash'::"text", 'Online'::"text", 'Cheque'::"text", 'Card'::"text", 'Other'::"text"])))
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


COMMENT ON TABLE "public"."payments" IS 'Records actual payment transactions received.';



COMMENT ON COLUMN "public"."payments"."receipt_number" IS 'Unique receipt identifier, can be system-generated or manually input.';



CREATE TABLE IF NOT EXISTS "public"."receipt_installments" (
    "receipt_id" "uuid" NOT NULL,
    "installment_id" "uuid" NOT NULL,
    "amount_applied" numeric(10,2) NOT NULL
);


ALTER TABLE "public"."receipt_installments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."receipts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admission_id" "uuid" NOT NULL,
    "receipt_number" "text" NOT NULL,
    "amount_paid" numeric(10,2) NOT NULL,
    "payment_date" "date" NOT NULL,
    "payment_method" "text",
    "generated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."receipts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."skills" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "category" "text",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."skills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_attendance" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "batch_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "is_present" boolean NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."student_attendance" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_settings" (
    "key" "text" NOT NULL,
    "value" "jsonb",
    "description" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."system_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tickets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "status" "public"."ticket_status" DEFAULT 'Open'::"public"."ticket_status",
    "priority" "public"."ticket_priority" DEFAULT 'Low'::"public"."ticket_priority",
    "category" "text",
    "student_id" "uuid",
    "assignee_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tickets" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_admission_financial_summary" AS
 WITH "payment_summary" AS (
         SELECT "payments"."admission_id",
            COALESCE("sum"("payments"."amount_paid"), (0)::numeric) AS "total_paid_actual"
           FROM "public"."payments"
          GROUP BY "payments"."admission_id"
        ), "inst_summary" AS (
         SELECT "installments"."admission_id",
            "bool_or"(
                CASE
                    WHEN ("installments"."status" = 'Overdue'::"text") THEN true
                    ELSE false
                END) AS "has_overdue"
           FROM "public"."installments"
          GROUP BY "installments"."admission_id"
        ), "course_summary" AS (
         SELECT "ac"."admission_id",
            "string_agg"("c"."name", ', '::"text") AS "certificate_name"
           FROM ("public"."admission_courses" "ac"
             JOIN "public"."courses" "c" ON (("ac"."course_id" = "c"."id")))
          GROUP BY "ac"."admission_id"
        )
 SELECT "a"."id" AS "admission_id",
    "s"."id" AS "student_id",
    "s"."admission_number",
    "s"."name" AS "student_name",
    "s"."phone_number" AS "student_phone_number",
    "cs"."certificate_name",
    "b"."name" AS "branch",
    "a"."created_at",
    "a"."base_amount",
    "a"."total_payable_amount",
    COALESCE("psum"."total_paid_actual", (0)::numeric) AS "total_paid",
    ("a"."total_payable_amount" - COALESCE("psum"."total_paid_actual", (0)::numeric)) AS "remaining_due",
        CASE
            WHEN (("a"."total_payable_amount" - COALESCE("psum"."total_paid_actual", (0)::numeric)) <= (0)::numeric) THEN 'Paid'::"text"
            WHEN COALESCE("isum"."has_overdue", false) THEN 'Overdue'::"text"
            ELSE 'Pending'::"text"
        END AS "status",
    "a"."approval_status"
   FROM (((((("public"."admissions" "a"
     JOIN "public"."students" "s" ON (("a"."student_id" = "s"."id")))
     LEFT JOIN "payment_summary" "psum" ON (("a"."id" = "psum"."admission_id")))
     LEFT JOIN "inst_summary" "isum" ON (("a"."id" = "isum"."admission_id")))
     LEFT JOIN "public"."batch_students" "bs" ON (("s"."id" = "bs"."student_id")))
     LEFT JOIN "public"."batches" "b" ON (("bs"."batch_id" = "b"."id")))
     LEFT JOIN "course_summary" "cs" ON (("a"."id" = "cs"."admission_id")));


ALTER VIEW "public"."v_admission_financial_summary" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_follow_up_task_list" AS
 SELECT "a"."id" AS "admission_id",
    "s"."admission_number",
    "s"."name" AS "student_name",
    "s"."phone_number" AS "student_phone",
    "b"."name" AS "batch_name",
    'AARTI JAISWAL'::"text" AS "assigned_to",
    COALESCE(( SELECT "follow_ups"."next_follow_up_date"
           FROM "public"."follow_ups"
          WHERE ("follow_ups"."admission_id" = "a"."id")
          ORDER BY "follow_ups"."created_at" DESC
         LIMIT 1), ( SELECT "installments"."due_date"
           FROM "public"."installments"
          WHERE (("installments"."admission_id" = "a"."id") AND ("installments"."status" = ANY (ARRAY['Pending'::"text", 'Overdue'::"text"])))
          ORDER BY "installments"."due_date"
         LIMIT 1)) AS "next_task_due_date",
    ( SELECT "count"(*) AS "count"
           FROM "public"."follow_ups" "fu"
          WHERE ("fu"."admission_id" = "a"."id")) AS "task_count",
    (COALESCE(( SELECT "sum"("i"."amount") AS "sum"
           FROM "public"."installments" "i"
          WHERE ("i"."admission_id" = "a"."id")), (0)::numeric) - COALESCE(( SELECT "sum"("p"."amount_paid") AS "sum"
           FROM "public"."payments" "p"
          WHERE ("p"."admission_id" = "a"."id")), (0)::numeric)) AS "total_due_amount",
    ( SELECT "max"("fu"."created_at") AS "max"
           FROM "public"."follow_ups" "fu"
          WHERE ("fu"."admission_id" = "a"."id")) AS "last_log_created_at"
   FROM ((("public"."admissions" "a"
     JOIN "public"."students" "s" ON (("a"."student_id" = "s"."id")))
     LEFT JOIN "public"."batch_students" "bs" ON (("s"."id" = "bs"."student_id")))
     LEFT JOIN "public"."batches" "b" ON (("bs"."batch_id" = "b"."id")));


ALTER VIEW "public"."v_follow_up_task_list" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_installment_status" AS
 SELECT "id",
    "admission_id",
    "due_date",
    "amount" AS "amount_due",
        CASE
            WHEN ("status" = 'Paid'::"text") THEN "amount"
            ELSE 0.00
        END AS "amount_paid",
        CASE
            WHEN ("status" = 'Paid'::"text") THEN 0.00
            ELSE "amount"
        END AS "balance_due",
    "status",
        CASE
            WHEN (("status" = 'Pending'::"text") AND ("due_date" < CURRENT_DATE)) THEN 'Overdue'::"text"
            ELSE "status"
        END AS "current_status"
   FROM "public"."installments" "i";


ALTER VIEW "public"."v_installment_status" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_student_placement_metrics" AS
 SELECT "id",
    "name" AS "student_name",
    "phone_number",
    "admission_number",
    ( SELECT "count"(DISTINCT "j"."id") AS "count"
           FROM ((("public"."jobs" "j"
             JOIN "public"."job_course_eligibility" "jce" ON (("j"."id" = "jce"."job_id")))
             JOIN "public"."admission_courses" "ac" ON (("jce"."course_id" = "ac"."course_id")))
             JOIN "public"."admissions" "a" ON (("ac"."admission_id" = "a"."id")))
          WHERE (("a"."student_id" = "s"."id") AND ("j"."status" = 'Open'::"text"))) AS "total_eligible_jobs",
    ( SELECT "count"(*) AS "count"
           FROM "public"."job_applications" "ja"
          WHERE ("ja"."student_id" = "s"."id")) AS "total_applied",
    ( SELECT "count"(*) AS "count"
           FROM "public"."job_applications" "ja"
          WHERE (("ja"."student_id" = "s"."id") AND ("ja"."status" = 'No_Show'::"text"))) AS "no_show_count",
    ( SELECT "count"(*) AS "count"
           FROM "public"."job_applications" "ja"
          WHERE (("ja"."student_id" = "s"."id") AND ("ja"."status" = ANY (ARRAY['Interviewed'::"text", 'Round_2'::"text", 'Selected'::"text", 'Rejected'::"text", 'Offer_Declined'::"text", 'Left_During_Probation'::"text"])))) AS "interviews_sat"
   FROM "public"."students" "s";


ALTER VIEW "public"."v_student_placement_metrics" OWNER TO "postgres";


ALTER TABLE ONLY "public"."activities" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."activities_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_notifications"
    ADD CONSTRAINT "admin_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admission_courses"
    ADD CONSTRAINT "admission_courses_pkey" PRIMARY KEY ("admission_id", "course_id");



ALTER TABLE ONLY "public"."admissions"
    ADD CONSTRAINT "admissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."announcements"
    ADD CONSTRAINT "announcements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."application_chats"
    ADD CONSTRAINT "application_chats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."batch_students"
    ADD CONSTRAINT "batch_students_pkey" PRIMARY KEY ("batch_id", "student_id");



ALTER TABLE ONLY "public"."batches"
    ADD CONSTRAINT "batches_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."batches"
    ADD CONSTRAINT "batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."books"
    ADD CONSTRAINT "books_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."books"
    ADD CONSTRAINT "books_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_read_status"
    ADD CONSTRAINT "chat_read_status_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."configuration"
    ADD CONSTRAINT "configuration_key_key" UNIQUE ("key");



ALTER TABLE ONLY "public"."configuration"
    ADD CONSTRAINT "configuration_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course_books"
    ADD CONSTRAINT "course_books_pkey" PRIMARY KEY ("course_id", "book_id");



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."faculty_availability"
    ADD CONSTRAINT "faculty_availability_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."faculty"
    ADD CONSTRAINT "faculty_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."faculty"
    ADD CONSTRAINT "faculty_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."faculty_skills"
    ADD CONSTRAINT "faculty_skills_pkey" PRIMARY KEY ("faculty_id", "skill_id");



ALTER TABLE ONLY "public"."fee_installments"
    ADD CONSTRAINT "fee_installments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."follow_ups"
    ADD CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."general_chats"
    ADD CONSTRAINT "general_chats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."installments"
    ADD CONSTRAINT "installments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."job_applications"
    ADD CONSTRAINT "job_applications_job_id_student_id_key" UNIQUE ("job_id", "student_id");



ALTER TABLE ONLY "public"."job_applications"
    ADD CONSTRAINT "job_applications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."job_course_eligibility"
    ADD CONSTRAINT "job_course_eligibility_pkey" PRIMARY KEY ("job_id", "course_id");



ALTER TABLE ONLY "public"."jobs"
    ADD CONSTRAINT "jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_receipt_number_key" UNIQUE ("receipt_number");



ALTER TABLE ONLY "public"."receipt_installments"
    ADD CONSTRAINT "receipt_installments_pkey" PRIMARY KEY ("receipt_id", "installment_id");



ALTER TABLE ONLY "public"."receipts"
    ADD CONSTRAINT "receipts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."receipts"
    ADD CONSTRAINT "receipts_receipt_number_key" UNIQUE ("receipt_number");



ALTER TABLE ONLY "public"."skills"
    ADD CONSTRAINT "skills_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."skills"
    ADD CONSTRAINT "skills_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_attendance"
    ADD CONSTRAINT "student_attendance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_attendance"
    ADD CONSTRAINT "student_attendance_unique" UNIQUE ("batch_id", "student_id", "date");



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_admission_number_key" UNIQUE ("admission_number");



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_phone_number_key" UNIQUE ("phone_number");



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_settings"
    ADD CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_phone_number_key" UNIQUE ("phone_number");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_username_key" UNIQUE ("username");



CREATE INDEX "idx_admission_courses_admission_id" ON "public"."admission_courses" USING "btree" ("admission_id");



CREATE INDEX "idx_admission_courses_course_id" ON "public"."admission_courses" USING "btree" ("course_id");



CREATE INDEX "idx_admissions_student_id" ON "public"."admissions" USING "btree" ("student_id");



CREATE INDEX "idx_batch_students_batch_id" ON "public"."batch_students" USING "btree" ("batch_id");



CREATE INDEX "idx_batch_students_student_id" ON "public"."batch_students" USING "btree" ("student_id");



CREATE INDEX "idx_batches_faculty_id" ON "public"."batches" USING "btree" ("faculty_id");



CREATE INDEX "idx_batches_skill_id" ON "public"."batches" USING "btree" ("skill_id");



CREATE INDEX "idx_chat_app_id" ON "public"."application_chats" USING "btree" ("application_id");



CREATE INDEX "idx_course_books_book_id" ON "public"."course_books" USING "btree" ("book_id");



CREATE INDEX "idx_course_books_course_id" ON "public"."course_books" USING "btree" ("course_id");



CREATE INDEX "idx_faculty_availability_faculty_id" ON "public"."faculty_availability" USING "btree" ("faculty_id");



CREATE INDEX "idx_faculty_skills_faculty_id" ON "public"."faculty_skills" USING "btree" ("faculty_id");



CREATE INDEX "idx_faculty_skills_skill_id" ON "public"."faculty_skills" USING "btree" ("skill_id");



CREATE INDEX "idx_fee_installments_admission_id" ON "public"."fee_installments" USING "btree" ("admission_id");



CREATE INDEX "idx_follow_ups_admission_id" ON "public"."follow_ups" USING "btree" ("admission_id");



CREATE INDEX "idx_follow_ups_next_date" ON "public"."follow_ups" USING "btree" ("next_follow_up_date");



CREATE INDEX "idx_general_chats_student" ON "public"."general_chats" USING "btree" ("student_id");



CREATE INDEX "idx_installments_admission_id" ON "public"."installments" USING "btree" ("admission_id");



CREATE INDEX "idx_payments_admission_id" ON "public"."payments" USING "btree" ("admission_id");



CREATE INDEX "idx_payments_payment_date" ON "public"."payments" USING "btree" ("payment_date");



CREATE INDEX "idx_receipts_admission_id" ON "public"."receipts" USING "btree" ("admission_id");



CREATE INDEX "idx_student_attendance_batch_id" ON "public"."student_attendance" USING "btree" ("batch_id");



CREATE INDEX "idx_student_attendance_student_id" ON "public"."student_attendance" USING "btree" ("student_id");



CREATE INDEX "idx_students_suspension" ON "public"."students" USING "btree" ("is_suspended", "is_banned");



CREATE INDEX "idx_tickets_assignee_id" ON "public"."tickets" USING "btree" ("assignee_id");



CREATE INDEX "idx_tickets_student_id" ON "public"."tickets" USING "btree" ("student_id");



CREATE INDEX "idx_users_faculty_id" ON "public"."users" USING "btree" ("faculty_id");



CREATE OR REPLACE TRIGGER "enforce_admin_assignee_on_tickets" BEFORE INSERT OR UPDATE ON "public"."tickets" FOR EACH ROW EXECUTE FUNCTION "public"."check_assignee_is_admin"();



ALTER TABLE ONLY "public"."admission_courses"
    ADD CONSTRAINT "admission_courses_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "public"."admissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."admission_courses"
    ADD CONSTRAINT "admission_courses_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."admissions"
    ADD CONSTRAINT "admissions_certificate_id_fkey" FOREIGN KEY ("certificate_id") REFERENCES "public"."certificates"("id");



ALTER TABLE ONLY "public"."admissions"
    ADD CONSTRAINT "admissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."announcements"
    ADD CONSTRAINT "announcements_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."application_chats"
    ADD CONSTRAINT "application_chats_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."job_applications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."application_chats"
    ADD CONSTRAINT "application_chats_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."application_chats"
    ADD CONSTRAINT "application_chats_sender_student_id_fkey" FOREIGN KEY ("sender_student_id") REFERENCES "public"."students"("id");



ALTER TABLE ONLY "public"."batch_students"
    ADD CONSTRAINT "batch_students_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."batch_students"
    ADD CONSTRAINT "batch_students_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."batches"
    ADD CONSTRAINT "batches_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "public"."faculty"("id");



ALTER TABLE ONLY "public"."batches"
    ADD CONSTRAINT "batches_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id");



ALTER TABLE ONLY "public"."chat_read_status"
    ADD CONSTRAINT "chat_read_status_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."job_applications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_read_status"
    ADD CONSTRAINT "chat_read_status_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_books"
    ADD CONSTRAINT "course_books_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_books"
    ADD CONSTRAINT "course_books_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."faculty_availability"
    ADD CONSTRAINT "faculty_availability_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "public"."faculty"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."faculty_skills"
    ADD CONSTRAINT "faculty_skills_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "public"."faculty"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."faculty_skills"
    ADD CONSTRAINT "faculty_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fee_installments"
    ADD CONSTRAINT "fee_installments_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "public"."admissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."admin_notifications"
    ADD CONSTRAINT "fk_admin_notifications_application" FOREIGN KEY ("application_id") REFERENCES "public"."job_applications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."admin_notifications"
    ADD CONSTRAINT "fk_admin_notifications_student" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."follow_ups"
    ADD CONSTRAINT "follow_ups_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "public"."admissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."follow_ups"
    ADD CONSTRAINT "follow_ups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."general_chats"
    ADD CONSTRAINT "general_chats_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."installments"
    ADD CONSTRAINT "installments_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "public"."admissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."job_applications"
    ADD CONSTRAINT "job_applications_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id");



ALTER TABLE ONLY "public"."job_applications"
    ADD CONSTRAINT "job_applications_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id");



ALTER TABLE ONLY "public"."job_course_eligibility"
    ADD CONSTRAINT "job_course_eligibility_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."job_course_eligibility"
    ADD CONSTRAINT "job_course_eligibility_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_sender_student_id_fkey" FOREIGN KEY ("sender_student_id") REFERENCES "public"."students"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "public"."admissions"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."receipt_installments"
    ADD CONSTRAINT "receipt_installments_installment_id_fkey" FOREIGN KEY ("installment_id") REFERENCES "public"."fee_installments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."receipt_installments"
    ADD CONSTRAINT "receipt_installments_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."receipts"
    ADD CONSTRAINT "receipts_admission_id_fkey" FOREIGN KEY ("admission_id") REFERENCES "public"."admissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."receipts"
    ADD CONSTRAINT "receipts_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."student_attendance"
    ADD CONSTRAINT "student_attendance_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_attendance"
    ADD CONSTRAINT "student_attendance_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "public"."faculty"("id") ON DELETE SET NULL;



CREATE POLICY "Students can insert own general chats" ON "public"."general_chats" FOR INSERT WITH CHECK (("auth"."uid"() = "student_id"));



CREATE POLICY "Students can view own general chats" ON "public"."general_chats" FOR SELECT USING (("auth"."uid"() = "student_id"));



ALTER TABLE "public"."general_chats" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."apply_payment_to_installments"("p_payment_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."apply_payment_to_installments"("p_payment_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_payment_to_installments"("p_payment_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_assignee_is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_assignee_is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_assignee_is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_admission_and_student"("p_student_name" "text", "p_student_phone_number" "text", "p_father_name" "text", "p_father_phone_number" "text", "p_permanent_address" "text", "p_current_address" "text", "p_address_proof_id_number" "text", "p_remarks" "text", "p_certificate_id" "uuid", "p_discount" numeric, "p_course_ids" "uuid"[], "p_installments" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."create_admission_and_student"("p_student_name" "text", "p_student_phone_number" "text", "p_father_name" "text", "p_father_phone_number" "text", "p_permanent_address" "text", "p_current_address" "text", "p_address_proof_id_number" "text", "p_remarks" "text", "p_certificate_id" "uuid", "p_discount" numeric, "p_course_ids" "uuid"[], "p_installments" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_admission_and_student"("p_student_name" "text", "p_student_phone_number" "text", "p_father_name" "text", "p_father_phone_number" "text", "p_permanent_address" "text", "p_current_address" "text", "p_address_proof_id_number" "text", "p_remarks" "text", "p_certificate_id" "uuid", "p_discount" numeric, "p_course_ids" "uuid"[], "p_installments" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_admission_and_student"("p_student_name" "text", "p_student_phone_number" "text", "p_father_name" "text", "p_father_phone_number" "text", "p_permanent_address" "text", "p_current_address" "text", "p_address_proof_id_number" "text", "p_remarks" "text", "p_certificate_id" "uuid", "p_total_fees" numeric, "p_discount" numeric, "p_courses" "uuid"[], "p_installments" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."create_admission_and_student"("p_student_name" "text", "p_student_phone_number" "text", "p_father_name" "text", "p_father_phone_number" "text", "p_permanent_address" "text", "p_current_address" "text", "p_address_proof_id_number" "text", "p_remarks" "text", "p_certificate_id" "uuid", "p_total_fees" numeric, "p_discount" numeric, "p_courses" "uuid"[], "p_installments" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_admission_and_student"("p_student_name" "text", "p_student_phone_number" "text", "p_father_name" "text", "p_father_phone_number" "text", "p_permanent_address" "text", "p_current_address" "text", "p_address_proof_id_number" "text", "p_remarks" "text", "p_certificate_id" "uuid", "p_total_fees" numeric, "p_discount" numeric, "p_courses" "uuid"[], "p_installments" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_admission_and_student"("p_student_name" "text", "p_student_phone_number" "text", "p_father_name" "text", "p_father_phone_number" "text", "p_permanent_address" "text", "p_current_address" "text", "p_identification_type" "text", "p_identification_number" "text", "p_date_of_admission" "date", "p_course_start_date" "date", "p_batch_preference" "text", "p_remarks" "text", "p_certificate_id" "uuid", "p_discount" numeric, "p_course_ids" "uuid"[], "p_installments" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."create_admission_and_student"("p_student_name" "text", "p_student_phone_number" "text", "p_father_name" "text", "p_father_phone_number" "text", "p_permanent_address" "text", "p_current_address" "text", "p_identification_type" "text", "p_identification_number" "text", "p_date_of_admission" "date", "p_course_start_date" "date", "p_batch_preference" "text", "p_remarks" "text", "p_certificate_id" "uuid", "p_discount" numeric, "p_course_ids" "uuid"[], "p_installments" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_admission_and_student"("p_student_name" "text", "p_student_phone_number" "text", "p_father_name" "text", "p_father_phone_number" "text", "p_permanent_address" "text", "p_current_address" "text", "p_identification_type" "text", "p_identification_number" "text", "p_date_of_admission" "date", "p_course_start_date" "date", "p_batch_preference" "text", "p_remarks" "text", "p_certificate_id" "uuid", "p_discount" numeric, "p_course_ids" "uuid"[], "p_installments" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_course_with_books"("p_name" "text", "p_price" numeric, "p_book_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."create_course_with_books"("p_name" "text", "p_price" numeric, "p_book_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_course_with_books"("p_name" "text", "p_price" numeric, "p_book_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_admission_dashboard"("search_term" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_admission_dashboard"("search_term" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_admission_dashboard"("search_term" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_unique_ticket_categories"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_unique_ticket_categories"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_unique_ticket_categories"() TO "service_role";



GRANT ALL ON FUNCTION "public"."record_payment"("p_admission_id" "uuid", "p_amount_paid" numeric, "p_payment_date" "date", "p_payment_method" "text", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."record_payment"("p_admission_id" "uuid", "p_amount_paid" numeric, "p_payment_date" "date", "p_payment_method" "text", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_payment"("p_admission_id" "uuid", "p_amount_paid" numeric, "p_payment_date" "date", "p_payment_method" "text", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."send_admin_reply_and_update_status"("p_ticket_id" "uuid", "p_sender_user_id" "uuid", "p_message" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."send_admin_reply_and_update_status"("p_ticket_id" "uuid", "p_sender_user_id" "uuid", "p_message" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."send_admin_reply_and_update_status"("p_ticket_id" "uuid", "p_sender_user_id" "uuid", "p_message" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_course_with_books"("p_course_id" "uuid", "p_name" "text", "p_price" numeric, "p_book_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."update_course_with_books"("p_course_id" "uuid", "p_name" "text", "p_price" numeric, "p_book_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_course_with_books"("p_course_id" "uuid", "p_name" "text", "p_price" numeric, "p_book_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_faculty_availability"("p_availability" "jsonb", "p_faculty_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."update_faculty_availability"("p_availability" "jsonb", "p_faculty_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_faculty_availability"("p_availability" "jsonb", "p_faculty_id" "uuid") TO "service_role";


















GRANT ALL ON TABLE "public"."activities" TO "anon";
GRANT ALL ON TABLE "public"."activities" TO "authenticated";
GRANT ALL ON TABLE "public"."activities" TO "service_role";



GRANT ALL ON SEQUENCE "public"."activities_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."activities_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."activities_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."admin_notifications" TO "anon";
GRANT ALL ON TABLE "public"."admin_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_notifications" TO "service_role";



GRANT ALL ON TABLE "public"."admission_courses" TO "anon";
GRANT ALL ON TABLE "public"."admission_courses" TO "authenticated";
GRANT ALL ON TABLE "public"."admission_courses" TO "service_role";



GRANT ALL ON SEQUENCE "public"."admission_number_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."admission_number_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."admission_number_seq" TO "service_role";



GRANT ALL ON TABLE "public"."admissions" TO "anon";
GRANT ALL ON TABLE "public"."admissions" TO "authenticated";
GRANT ALL ON TABLE "public"."admissions" TO "service_role";



GRANT ALL ON TABLE "public"."announcements" TO "anon";
GRANT ALL ON TABLE "public"."announcements" TO "authenticated";
GRANT ALL ON TABLE "public"."announcements" TO "service_role";



GRANT ALL ON TABLE "public"."application_chats" TO "anon";
GRANT ALL ON TABLE "public"."application_chats" TO "authenticated";
GRANT ALL ON TABLE "public"."application_chats" TO "service_role";



GRANT ALL ON TABLE "public"."batch_students" TO "anon";
GRANT ALL ON TABLE "public"."batch_students" TO "authenticated";
GRANT ALL ON TABLE "public"."batch_students" TO "service_role";



GRANT ALL ON TABLE "public"."batches" TO "anon";
GRANT ALL ON TABLE "public"."batches" TO "authenticated";
GRANT ALL ON TABLE "public"."batches" TO "service_role";



GRANT ALL ON TABLE "public"."books" TO "anon";
GRANT ALL ON TABLE "public"."books" TO "authenticated";
GRANT ALL ON TABLE "public"."books" TO "service_role";



GRANT ALL ON TABLE "public"."certificates" TO "anon";
GRANT ALL ON TABLE "public"."certificates" TO "authenticated";
GRANT ALL ON TABLE "public"."certificates" TO "service_role";



GRANT ALL ON TABLE "public"."chat_read_status" TO "anon";
GRANT ALL ON TABLE "public"."chat_read_status" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_read_status" TO "service_role";



GRANT ALL ON TABLE "public"."configuration" TO "anon";
GRANT ALL ON TABLE "public"."configuration" TO "authenticated";
GRANT ALL ON TABLE "public"."configuration" TO "service_role";



GRANT ALL ON TABLE "public"."course_books" TO "anon";
GRANT ALL ON TABLE "public"."course_books" TO "authenticated";
GRANT ALL ON TABLE "public"."course_books" TO "service_role";



GRANT ALL ON TABLE "public"."courses" TO "anon";
GRANT ALL ON TABLE "public"."courses" TO "authenticated";
GRANT ALL ON TABLE "public"."courses" TO "service_role";



GRANT ALL ON TABLE "public"."faculty" TO "anon";
GRANT ALL ON TABLE "public"."faculty" TO "authenticated";
GRANT ALL ON TABLE "public"."faculty" TO "service_role";



GRANT ALL ON TABLE "public"."faculty_availability" TO "anon";
GRANT ALL ON TABLE "public"."faculty_availability" TO "authenticated";
GRANT ALL ON TABLE "public"."faculty_availability" TO "service_role";



GRANT ALL ON TABLE "public"."faculty_skills" TO "anon";
GRANT ALL ON TABLE "public"."faculty_skills" TO "authenticated";
GRANT ALL ON TABLE "public"."faculty_skills" TO "service_role";



GRANT ALL ON TABLE "public"."fee_installments" TO "anon";
GRANT ALL ON TABLE "public"."fee_installments" TO "authenticated";
GRANT ALL ON TABLE "public"."fee_installments" TO "service_role";



GRANT ALL ON TABLE "public"."follow_ups" TO "anon";
GRANT ALL ON TABLE "public"."follow_ups" TO "authenticated";
GRANT ALL ON TABLE "public"."follow_ups" TO "service_role";



GRANT ALL ON TABLE "public"."students" TO "anon";
GRANT ALL ON TABLE "public"."students" TO "authenticated";
GRANT ALL ON TABLE "public"."students" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."follow_up_details" TO "anon";
GRANT ALL ON TABLE "public"."follow_up_details" TO "authenticated";
GRANT ALL ON TABLE "public"."follow_up_details" TO "service_role";



GRANT ALL ON TABLE "public"."general_chats" TO "anon";
GRANT ALL ON TABLE "public"."general_chats" TO "authenticated";
GRANT ALL ON TABLE "public"."general_chats" TO "service_role";



GRANT ALL ON TABLE "public"."installments" TO "anon";
GRANT ALL ON TABLE "public"."installments" TO "authenticated";
GRANT ALL ON TABLE "public"."installments" TO "service_role";



GRANT ALL ON TABLE "public"."job_applications" TO "anon";
GRANT ALL ON TABLE "public"."job_applications" TO "authenticated";
GRANT ALL ON TABLE "public"."job_applications" TO "service_role";



GRANT ALL ON TABLE "public"."job_course_eligibility" TO "anon";
GRANT ALL ON TABLE "public"."job_course_eligibility" TO "authenticated";
GRANT ALL ON TABLE "public"."job_course_eligibility" TO "service_role";



GRANT ALL ON TABLE "public"."jobs" TO "anon";
GRANT ALL ON TABLE "public"."jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."jobs" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."receipt_installments" TO "anon";
GRANT ALL ON TABLE "public"."receipt_installments" TO "authenticated";
GRANT ALL ON TABLE "public"."receipt_installments" TO "service_role";



GRANT ALL ON TABLE "public"."receipts" TO "anon";
GRANT ALL ON TABLE "public"."receipts" TO "authenticated";
GRANT ALL ON TABLE "public"."receipts" TO "service_role";



GRANT ALL ON TABLE "public"."skills" TO "anon";
GRANT ALL ON TABLE "public"."skills" TO "authenticated";
GRANT ALL ON TABLE "public"."skills" TO "service_role";



GRANT ALL ON TABLE "public"."student_attendance" TO "anon";
GRANT ALL ON TABLE "public"."student_attendance" TO "authenticated";
GRANT ALL ON TABLE "public"."student_attendance" TO "service_role";



GRANT ALL ON TABLE "public"."system_settings" TO "anon";
GRANT ALL ON TABLE "public"."system_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."system_settings" TO "service_role";



GRANT ALL ON TABLE "public"."tickets" TO "anon";
GRANT ALL ON TABLE "public"."tickets" TO "authenticated";
GRANT ALL ON TABLE "public"."tickets" TO "service_role";



GRANT ALL ON TABLE "public"."v_admission_financial_summary" TO "anon";
GRANT ALL ON TABLE "public"."v_admission_financial_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."v_admission_financial_summary" TO "service_role";



GRANT ALL ON TABLE "public"."v_follow_up_task_list" TO "anon";
GRANT ALL ON TABLE "public"."v_follow_up_task_list" TO "authenticated";
GRANT ALL ON TABLE "public"."v_follow_up_task_list" TO "service_role";



GRANT ALL ON TABLE "public"."v_installment_status" TO "anon";
GRANT ALL ON TABLE "public"."v_installment_status" TO "authenticated";
GRANT ALL ON TABLE "public"."v_installment_status" TO "service_role";



GRANT ALL ON TABLE "public"."v_student_placement_metrics" TO "anon";
GRANT ALL ON TABLE "public"."v_student_placement_metrics" TO "authenticated";
GRANT ALL ON TABLE "public"."v_student_placement_metrics" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
































  create policy "Allow read access to resume files i5g8va_0"
  on "storage"."objects"
  as permissive
  for select
  to public
using (((bucket_id = 'resumes'::text) AND (auth.role() = 'authenticated'::text)));



  create policy "Allow users to upload their own resumes i5g8va_0"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check (((bucket_id = 'resumes'::text) AND (auth.role() = 'authenticated'::text)));



  create policy "allow all authenticated uploads"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check ((bucket_id = 'resumes'::text));



  create policy "allow authenticated read"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using ((bucket_id = 'resumes'::text));



  create policy "resumes insert"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check ((bucket_id = 'resumes'::text));



  create policy "resumes select"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using ((bucket_id = 'resumes'::text));



  create policy "resumes update"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using ((bucket_id = 'resumes'::text))
with check ((bucket_id = 'resumes'::text));



