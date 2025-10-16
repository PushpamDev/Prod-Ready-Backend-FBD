-- =================================================================
--          COMPLETE INSTITUTE MANAGEMENT DATABASE SCHEMA
--                       VERSION 3.2 (STABLE & FIXED)
-- =================================================================
-- This master script combines all modules into a single, cohesive schema.
-- It includes:
-- 1. Faculty, Skills, and Batch Scheduling
-- 2. The perfected Admissions, Fees, and Follow-up System
-- 3. The Support Ticket and Messaging System
-- 4. User Authentication and System Logging

-- =================================================================
-- I. CLEAN SLATE: Drop all objects for a fresh start (FIXED)
-- =================================================================
-- Drop objects in the correct order of dependency. Dropping tables with
-- CASCADE is the most robust method, as it automatically removes dependent
-- objects like triggers, functions, and views referencing those tables.

-- 1. Drop Views (as they depend on tables)
DROP VIEW IF EXISTS public.v_follow_up_list;
DROP VIEW IF EXISTS public.v_admission_financial_summary;
DROP VIEW IF EXISTS public.v_installment_status;

-- 2. Drop Tables (CASCADE handles all dependencies like triggers, fkeys, etc.)
DROP TABLE IF EXISTS public.activities CASCADE;
DROP TABLE IF EXISTS public.announcements CASCADE;
DROP TABLE IF EXISTS public.messages CASCADE;
DROP TABLE IF EXISTS public.tickets CASCADE;
DROP TABLE IF EXISTS public.student_attendance CASCADE;
DROP TABLE IF EXISTS public.batch_students CASCADE;
DROP TABLE IF EXISTS public.faculty_skills CASCADE;
DROP TABLE IF EXISTS public.faculty_availability CASCADE;
DROP TABLE IF EXISTS public.batches CASCADE;
DROP TABLE IF EXISTS public.receipt_installments CASCADE;
DROP TABLE IF EXISTS public.receipts CASCADE;
DROP TABLE IF EXISTS public.follow_ups CASCADE;
DROP TABLE IF EXISTS public.fee_installments CASCADE;
DROP TABLE IF EXISTS public.admission_courses CASCADE;
DROP TABLE IF EXISTS public.admissions CASCADE;
DROP TABLE IF EXISTS public.courses CASCADE;
DROP TABLE IF EXISTS public.certificates CASCADE;
DROP TABLE IF EXISTS public.skills CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;
DROP TABLE IF EXISTS public.faculty CASCADE;
DROP TABLE IF EXISTS public.students CASCADE;

-- 3. Drop Functions (most are dropped by CASCADE, but we drop them explicitly for safety)
DROP FUNCTION IF EXISTS public.create_admission_and_student(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, NUMERIC, NUMERIC, UUID[], JSONB);
DROP FUNCTION IF EXISTS public.record_payment(UUID, NUMERIC, DATE, TEXT, UUID);
DROP FUNCTION IF EXISTS public.check_assignee_is_admin();
DROP FUNCTION IF EXISTS public.get_unique_ticket_categories();
DROP FUNCTION IF EXISTS public.send_admin_reply_and_update_status(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.update_faculty_availability(JSONB, UUID);

-- 4. Drop Types (must be last as other objects depend on them)
DROP TYPE IF EXISTS public.user_role;
DROP TYPE IF EXISTS public.ticket_status;
DROP TYPE IF EXISTS public.ticket_priority;
DROP TYPE IF EXISTS public.installment_status;


-- =================================================================
-- II. CUSTOM TYPES (ENUMS): For data consistency
-- =================================================================
CREATE TYPE public.user_role AS ENUM ('admin', 'faculty');
CREATE TYPE public.ticket_status AS ENUM ('Open', 'In Progress', 'Resolved');
CREATE TYPE public.ticket_priority AS ENUM ('Low', 'Medium', 'High');
CREATE TYPE public.installment_status AS ENUM ('Due', 'Paid', 'Partially Paid', 'Overdue');


-- =================================================================
-- III. CORE ENTITY TABLES
-- =================================================================

-- SKILLS, COURSES, CERTIFICATES: The "products" your institute offers.
CREATE TABLE public.skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    category TEXT,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE TABLE public.courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE TABLE public.certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    cost NUMERIC(10, 2) NOT NULL CHECK (cost >= 0),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- FACULTY, STUDENTS, USERS: The "people" in your system.
CREATE TABLE public.faculty (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone_number TEXT,
    employment_type TEXT, -- e.g., 'Full-time', 'Part-time'
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE TABLE public.students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    phone_number TEXT UNIQUE,
    admission_number TEXT UNIQUE,
    father_name TEXT,
    father_phone_number TEXT,
    permanent_address TEXT,
    current_address TEXT,
    address_proof_id_number TEXT,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE TABLE public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE,
    phone_number TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    role public.user_role,
    faculty_id UUID REFERENCES public.faculty(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT at_least_one_login_method CHECK (username IS NOT NULL OR phone_number IS NOT NULL)
);

-- =================================================================
-- IV. MODULE-SPECIFIC TABLES & JUNCTIONS
-- =================================================================

-- -----------------------------------------------------------------
-- A. Academics & Scheduling Module
-- -----------------------------------------------------------------
CREATE TABLE public.batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    start_date DATE,
    end_date DATE,
    start_time TIME,
    end_time TIME,
    faculty_id UUID REFERENCES public.faculty(id),
    skill_id UUID REFERENCES public.skills(id),
    max_students INT,
    status TEXT, -- e.g., 'Upcoming', 'Active', 'Completed'
    days_of_week TEXT[], -- e.g., {'Monday', 'Wednesday', 'Friday'}
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE TABLE public.faculty_availability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    faculty_id UUID NOT NULL REFERENCES public.faculty(id) ON DELETE CASCADE,
    day_of_week TEXT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT check_start_end_times CHECK (start_time < end_time)
);
CREATE TABLE public.student_attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    batch_id UUID NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    is_present BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT student_attendance_unique UNIQUE (batch_id, student_id, date)
);
CREATE TABLE public.faculty_skills ( -- Junction Table
    faculty_id UUID NOT NULL REFERENCES public.faculty(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
    PRIMARY KEY (faculty_id, skill_id)
);
CREATE TABLE public.batch_students ( -- Junction Table
    batch_id UUID NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    PRIMARY KEY (batch_id, student_id)
);

-- -----------------------------------------------------------------
-- B. Admissions & Finance Module (Perfected)
-- -----------------------------------------------------------------
CREATE TABLE public.admissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    certificate_id UUID REFERENCES public.certificates(id),
    total_fees NUMERIC(10, 2) NOT NULL,
    discount NUMERIC(10, 2) DEFAULT 0,
    final_fees NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE TABLE public.fee_installments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admission_id UUID NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
    due_date DATE NOT NULL,
    amount_due NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE TABLE public.receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admission_id UUID NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
    receipt_number TEXT NOT NULL UNIQUE,
    amount_paid NUMERIC(10, 2) NOT NULL,
    payment_date DATE NOT NULL,
    payment_method TEXT,
    generated_by UUID REFERENCES public.users(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE TABLE public.follow_ups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admission_id UUID NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
    follow_up_date DATE NOT NULL,
    notes TEXT,
    user_id UUID REFERENCES public.users(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE TABLE public.admission_courses ( -- Junction Table
    admission_id UUID NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    PRIMARY KEY (admission_id, course_id)
);
CREATE TABLE public.receipt_installments ( -- Junction Table
    receipt_id UUID NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,
    installment_id UUID NOT NULL REFERENCES public.fee_installments(id) ON DELETE CASCADE,
    amount_applied NUMERIC(10, 2) NOT NULL,
    PRIMARY KEY (receipt_id, installment_id)
);

-- -----------------------------------------------------------------
-- C. Support & Communication Module
-- -----------------------------------------------------------------
CREATE TABLE public.tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status public.ticket_status DEFAULT 'Open',
    priority public.ticket_priority DEFAULT 'Low',
    category TEXT,
    student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
    assignee_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE CASCADE,
  sender_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  sender_student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CONSTRAINT chk_one_sender CHECK (
    (sender_user_id IS NOT NULL AND sender_student_id IS NULL) OR
    (sender_user_id IS NULL AND sender_student_id IS NOT NULL)
  )
);
CREATE TABLE public.announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('all', 'batch')),
    batch_id UUID REFERENCES public.batches(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT scope_batch_consistency CHECK (
        (scope = 'all' AND batch_id IS NULL) OR
        (scope = 'batch' AND batch_id IS NOT NULL)
    )
);

-- -----------------------------------------------------------------
-- D. System Logging Module
-- -----------------------------------------------------------------
CREATE TABLE public.activities (
    id bigserial PRIMARY KEY,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    action character varying,
    item character varying,
    "user" character varying,
    type character varying
);


-- =================================================================
-- V. DATABASE VIEWS (SMART REPORTING LAYER)
-- =================================================================
CREATE OR REPLACE VIEW public.v_installment_status AS
SELECT fi.id, fi.admission_id, fi.due_date, fi.amount_due, COALESCE(SUM(ri.amount_applied), 0) AS amount_paid, (fi.amount_due - COALESCE(SUM(ri.amount_applied), 0)) AS balance_due,
    CASE
        WHEN (fi.amount_due - COALESCE(SUM(ri.amount_applied), 0)) <= 0 THEN 'Paid'::public.installment_status
        WHEN COALESCE(SUM(ri.amount_applied), 0) > 0 THEN 'Partially Paid'::public.installment_status
        WHEN fi.due_date < CURRENT_DATE THEN 'Overdue'::public.installment_status
        ELSE 'Due'::public.installment_status
    END AS status
FROM public.fee_installments fi LEFT JOIN public.receipt_installments ri ON fi.id = ri.installment_id GROUP BY fi.id;

CREATE OR REPLACE VIEW public.v_admission_financial_summary AS
SELECT a.id AS admission_id, s.id AS student_id, s.name AS student_name, s.phone_number, a.final_fees, COALESCE(SUM(r.amount_paid), 0) AS total_paid, (a.final_fees - COALESCE(SUM(r.amount_paid), 0)) AS total_balance_due
FROM public.admissions a JOIN public.students s ON a.student_id = s.id LEFT JOIN public.receipts r ON a.id = r.admission_id GROUP BY a.id, s.id;

CREATE OR REPLACE VIEW public.v_follow_up_list AS
SELECT DISTINCT ON (vis.admission_id) vis.admission_id, s.name AS student_name, s.phone_number,
    (SELECT COUNT(*) FROM public.v_installment_status WHERE admission_id = vis.admission_id AND status = 'Overdue') AS overdue_installments_count,
    (SELECT SUM(balance_due) FROM public.v_installment_status WHERE admission_id = vis.admission_id AND status IN ('Overdue', 'Partially Paid')) AS total_amount_overdue
FROM public.v_installment_status vis JOIN public.admissions a ON vis.admission_id = a.id JOIN public.students s ON a.student_id = s.id
WHERE vis.status = 'Overdue';

-- =================================================================
-- VI. DATABASE FUNCTIONS (BUSINESS LOGIC ENGINE)
-- =================================================================
CREATE OR REPLACE FUNCTION public.create_admission_and_student(p_student_name TEXT, p_student_phone_number TEXT, p_father_name TEXT, p_father_phone_number TEXT, p_permanent_address TEXT, p_current_address TEXT, p_address_proof_id_number TEXT, p_remarks TEXT, p_certificate_id UUID, p_total_fees NUMERIC, p_discount NUMERIC, p_courses UUID[], p_installments JSONB)
RETURNS UUID AS $$
DECLARE new_student_id UUID; new_admission_id UUID; v_final_fees NUMERIC; course_id UUID; installment RECORD;
BEGIN
  v_final_fees := p_total_fees - COALESCE(p_discount, 0);
  INSERT INTO public.students (name, phone_number, father_name, father_phone_number, permanent_address, current_address, address_proof_id_number, remarks, admission_number) VALUES (p_student_name, p_student_phone_number, p_father_name, p_father_phone_number, p_permanent_address, p_current_address, p_address_proof_id_number, p_remarks, 'ADM-' || upper(substr(md5(random()::text), 0, 8))) RETURNING id INTO new_student_id;
  INSERT INTO public.admissions (student_id, certificate_id, total_fees, discount, final_fees) VALUES (new_student_id, p_certificate_id, p_total_fees, p_discount, v_final_fees) RETURNING id INTO new_admission_id;
  IF p_courses IS NOT NULL THEN FOREACH course_id IN ARRAY p_courses LOOP INSERT INTO public.admission_courses (admission_id, course_id) VALUES (new_admission_id, course_id); END LOOP; END IF;
  IF p_installments IS NOT NULL THEN FOR installment IN SELECT * FROM jsonb_to_recordset(p_installments) AS x(due_date DATE, amount NUMERIC) LOOP INSERT INTO public.fee_installments (admission_id, due_date, amount_due) VALUES (new_admission_id, installment.due_date, installment.amount); END LOOP; END IF;
  RETURN new_admission_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.record_payment(p_admission_id UUID, p_amount_paid NUMERIC, p_payment_date DATE, p_payment_method TEXT, p_user_id UUID)
RETURNS UUID AS $$
DECLARE new_receipt_id UUID; remaining_payment_amount NUMERIC := p_amount_paid; installment_to_pay RECORD;
BEGIN
    INSERT INTO public.receipts (admission_id, amount_paid, payment_date, payment_method, generated_by, receipt_number) VALUES (p_admission_id, p_amount_paid, p_payment_date, p_payment_method, p_user_id, 'RCPT-' || upper(substr(md5(random()::text), 0, 10))) RETURNING id INTO new_receipt_id;
    FOR installment_to_pay IN SELECT id, balance_due FROM public.v_installment_status WHERE admission_id = p_admission_id AND status IN ('Overdue', 'Partially Paid', 'Due') ORDER BY due_date ASC LOOP
        IF remaining_payment_amount <= 0 THEN EXIT; END IF;
        DECLARE amount_to_apply NUMERIC;
        BEGIN
            amount_to_apply := LEAST(remaining_payment_amount, installment_to_pay.balance_due);
            INSERT INTO public.receipt_installments (receipt_id, installment_id, amount_applied) VALUES (new_receipt_id, installment_to_pay.id, amount_to_apply);
            remaining_payment_amount := remaining_payment_amount - amount_to_apply;
        END;
    END LOOP;
    RETURN new_receipt_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.update_faculty_availability(p_availability JSONB, p_faculty_id UUID)
RETURNS VOID AS $$
BEGIN
    DELETE FROM public.faculty_availability WHERE faculty_id = p_faculty_id;
    IF jsonb_array_length(p_availability) > 0 THEN
        INSERT INTO public.faculty_availability (faculty_id, day_of_week, start_time, end_time)
        SELECT p_faculty_id, (value->>'day_of_week')::text, (value->>'start_time')::time, (value->>'end_time')::time
        FROM jsonb_array_elements(p_availability) AS value;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.send_admin_reply_and_update_status(p_ticket_id UUID, p_sender_user_id UUID, p_message TEXT)
RETURNS JSON AS $$
DECLARE new_message RECORD;
BEGIN
  INSERT INTO messages (ticket_id, sender_user_id, message) VALUES (p_ticket_id, p_sender_user_id, p_message) RETURNING * INTO new_message;
  UPDATE tickets SET status = 'In Progress' WHERE id = p_ticket_id AND status = 'Open';
  RETURN row_to_json(new_message);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.get_unique_ticket_categories()
RETURNS TABLE(category TEXT) AS $$
BEGIN
  RETURN QUERY SELECT DISTINCT t.category FROM tickets as t WHERE t.category IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.check_assignee_is_admin()
RETURNS TRIGGER AS $$
DECLARE assignee_role public.user_role;
BEGIN
  IF NEW.assignee_id IS NULL THEN RETURN NEW; END IF;
  SELECT role INTO assignee_role FROM public.users WHERE id = NEW.assignee_id;
  IF assignee_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Assignee Error: User with ID % is not an admin.', NEW.assignee_id; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =================================================================
-- VII. TRIGGERS: Automated actions
-- =================================================================
-- This trigger is created after the 'tickets' table and the 'check_assignee_is_admin' function exist.
CREATE TRIGGER enforce_admin_assignee_on_tickets
BEFORE INSERT OR UPDATE ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.check_assignee_is_admin();

-- =================================================================
-- VIII. INDEXES & PERMISSIONS
-- =================================================================
-- Add indexes for performance
CREATE INDEX idx_users_faculty_id ON public.users(faculty_id);
CREATE INDEX idx_batches_faculty_id ON public.batches(faculty_id);
CREATE INDEX idx_batches_skill_id ON public.batches(skill_id);
CREATE INDEX idx_faculty_availability_faculty_id ON public.faculty_availability(faculty_id);
CREATE INDEX idx_student_attendance_student_id ON public.student_attendance(student_id);
CREATE INDEX idx_student_attendance_batch_id ON public.student_attendance(batch_id);
CREATE INDEX idx_admissions_student_id ON public.admissions(student_id);
CREATE INDEX idx_tickets_student_id ON public.tickets(student_id);
CREATE INDEX idx_tickets_assignee_id ON public.tickets(assignee_id);
CREATE INDEX idx_announcements_batch_id ON public.announcements(batch_id);
-- Grant permissions (repeat for all tables, views, and functions)
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

