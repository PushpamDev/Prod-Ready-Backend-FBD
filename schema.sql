-- Enable pgcrypto extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Drop existing tables to avoid conflicts
DROP TABLE IF EXISTS public.batch_students;
DROP TABLE IF EXISTS public.faculty_availability;
DROP TABLE IF EXISTS public.faculty_skills;
DROP TABLE IF EXISTS public.student_attendance;
DROP TABLE IF EXISTS public.batches;
DROP TABLE IF EXISTS public.faculty;
DROP TABLE IF EXISTS public.skills;
DROP TABLE IF EXISTS public.students;
DROP TABLE IF EXISTS public.users;
DROP TABLE IF EXISTS public.activities;
DROP TYPE IF EXISTS public.user_role;

-- Skills Table
CREATE TABLE public.skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    category TEXT,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE public.skills IS 'List of skills that faculty members can have.';

-- Faculty Table
CREATE TABLE public.faculty (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone_number TEXT,
    employment_type TEXT, -- e.g., 'Full-time', 'Part-time'
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE public.faculty IS 'Information about faculty members.';

-- User Roles Enum Type
CREATE TYPE public.user_role AS ENUM ('admin', 'faculty');

-- Users Table
CREATE TABLE public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE,
    phone_number TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    role public.user_role,
    faculty_id UUID REFERENCES public.faculty(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT at_least_one_login_method CHECK (username IS NOT NULL OR phone_number IS NOT NULL)
);
COMMENT ON TABLE public.users IS 'Stores user credentials and roles for authentication and authorization.';

-- Students Table
CREATE TABLE public.students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    admission_number TEXT NOT NULL UNIQUE,
    phone_number TEXT,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE public.students IS 'Information about students.';

-- Batches Table
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
    created_at TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE public.batches IS 'Information about student batches.';

-- Batch Students Junction Table
CREATE TABLE public.batch_students (
    batch_id UUID NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    PRIMARY KEY (batch_id, student_id)
);
COMMENT ON TABLE public.batch_students IS 'Maps students to their batches.';

-- Faculty Skills Junction Table
CREATE TABLE public.faculty_skills (
    faculty_id UUID NOT NULL REFERENCES public.faculty(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
    PRIMARY KEY (faculty_id, skill_id)
);
COMMENT ON TABLE public.faculty_skills IS 'Maps faculty to their skills.';

-- Faculty Availability Table
CREATE TABLE public.faculty_availability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    faculty_id UUID NOT NULL REFERENCES public.faculty(id) ON DELETE CASCADE,
    day_of_week TEXT NOT NULL, -- e.g., 'Monday', 'Tuesday'
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT check_start_end_times CHECK (start_time < end_time)
);
COMMENT ON TABLE public.faculty_availability IS 'Stores recurring weekly free time slots for faculty members.';

-- Activities Table
CREATE TABLE public.activities (
    id bigserial PRIMARY KEY,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    action character varying,
    item character varying,
    "user" character varying,
    type character varying
);
COMMENT ON TABLE public.activities IS 'Logs activities such as creations, updates, and deletions.';

-- Student Attendance Table
CREATE TABLE public.student_attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    batch_id UUID NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    is_present BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT student_attendance_unique UNIQUE (batch_id, student_id, date)
);
COMMENT ON TABLE public.student_attendance IS 'Stores student attendance for each batch and date.';

-- Add indexes for foreign keys to improve query performance
CREATE INDEX idx_faculty_skills_faculty_id ON public.faculty_skills(faculty_id);
CREATE INDEX idx_faculty_skills_skill_id ON public.faculty_skills(skill_id);
CREATE INDEX idx_faculty_availability_faculty_id ON public.faculty_availability(faculty_id);
CREATE INDEX idx_batches_faculty_id ON public.batches(faculty_id);
CREATE INDEX idx_batches_skill_id ON public.batches(skill_id);
CREATE INDEX idx_batch_students_batch_id ON public.batch_students(batch_id);
CREATE INDEX idx_batch_students_student_id ON public.batch_students(student_id);
CREATE INDEX idx_student_attendance_student_id ON public.student_attendance(student_id);
CREATE INDEX idx_student_attendance_batch_id ON public.student_attendance(batch_id);


-- Grant all permissions to the service_role for all tables
GRANT ALL ON TABLE public.users TO service_role;
GRANT ALL ON TABLE public.faculty TO service_role;
GRANT ALL ON TABLE public.skills TO service_role;
GRANT ALL ON TABLE public.faculty_skills TO service_role;
GRANT ALL ON TABLE public.faculty_availability TO service_role;
GRANT ALL ON TABLE public.batches TO service_role;
GRANT ALL ON TABLE public.students TO service_role;
GRANT ALL ON TABLE public.batch_students TO service_role;
GRANT ALL ON TABLE public.activities TO service_role;
GRANT ALL ON TABLE public.student_attendance TO service_role;

-- Create the announcements table
CREATE TABLE public.announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('all', 'batch')),
    batch_id UUID REFERENCES public.batches(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT scope_batch_consistency CHECK (
        (scope = 'all' AND batch_id IS NULL) OR
        (scope = 'batch' AND batch_id IS NOT NULL)
    )
);
COMMENT ON TABLE public.announcements IS 'Stores announcements for all users or specific batches.';

-- Create indexes for faster querying
CREATE INDEX idx_announcements_scope ON public.announcements(scope);
CREATE INDEX idx_announcements_batch_id ON public.announcements(batch_id);
CREATE INDEX idx_announcements_created_at ON public.announcements(created_at DESC);

-- Grant all permissions to the service_role for the announcements table
GRANT ALL ON TABLE public.announcements TO service_role;

-- Drop the table if it exists to start fresh
DROP TABLE IF EXISTS public.tickets;

-- Create a type for ticket status to ensure data consistency
DROP TYPE IF EXISTS public.ticket_status;
CREATE TYPE public.ticket_status AS ENUM ('Open', 'In Progress', 'Resolved');

-- Create a type for ticket priority
DROP TYPE IF EXISTS public.ticket_priority;
CREATE TYPE public.ticket_priority AS ENUM ('Low', 'Medium', 'High');


-- Create the tickets table with correct foreign keys and new fields
CREATE TABLE public.tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    
    -- Aligned with frontend types
    status public.ticket_status DEFAULT 'Open',
    priority public.ticket_priority DEFAULT 'Low',
    category TEXT, -- e.g., 'Fee', 'Placement', 'Certificate'
    
    -- Correctly references students as creators and users as assignees
    student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
    assignee_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.tickets IS 'Stores support tickets submitted by students.';

-- Create indexes for performance on frequently queried columns
CREATE INDEX idx_tickets_status ON public.tickets(status);
CREATE INDEX idx_tickets_student_id ON public.tickets(student_id);
CREATE INDEX idx_tickets_assignee_id ON public.tickets(assignee_id);

-- Grant permissions to the service role
GRANT ALL ON TABLE public.tickets TO service_role;

-- First, create a function that will be executed by the trigger.
-- This function checks if the provided assignee_id belongs to an admin.
CREATE OR REPLACE FUNCTION public.check_assignee_is_admin()
RETURNS TRIGGER AS $$
DECLARE
  assignee_role public.user_role;
BEGIN
  -- If the assignee_id is not being set or is being set to NULL, allow the operation.
  IF NEW.assignee_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Query the users table to get the role of the user being assigned.
  SELECT role INTO assignee_role
  FROM public.users
  WHERE id = NEW.assignee_id;

  -- If the role is not 'admin', raise an exception to block the operation.
  IF assignee_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Assignee Error: User with ID % is not an admin.', NEW.assignee_id;
  END IF;

  -- If the check passes, allow the INSERT or UPDATE to proceed.
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Before creating a new trigger, drop any existing one to avoid errors on re-run.
DROP TRIGGER IF EXISTS enforce_admin_assignee_on_tickets ON public.tickets;

-- Now, create the trigger on the 'tickets' table.
-- It will execute the function before any INSERT or UPDATE operation.
CREATE TRIGGER enforce_admin_assignee_on_tickets
BEFORE INSERT OR UPDATE ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.check_assignee_is_admin();

COMMENT ON TRIGGER enforce_admin_assignee_on_tickets ON public.tickets IS 'Ensures that only users with the admin role can be assigned to a ticket.';

CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE CASCADE,
  sender_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  sender_student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_one_sender CHECK (
    (sender_user_id IS NOT NULL AND sender_student_id IS NULL) OR
    (sender_user_id IS NULL AND sender_student_id IS NOT NULL)
  )
);

COMMENT ON TABLE public.messages IS 'Stores chat messages related to a ticket.';
GRANT SELECT ON TABLE messages TO service_role;
GRANT SELECT ON TABLE messages TO authenticated;
GRANT INSERT ON TABLE messages TO service_role;
GRANT INSERT ON TABLE messages TO authenticated;
GRANT INSERT ON TABLE activities TO service_role;
GRANT INSERT ON TABLE activities TO authenticated;
CREATE OR REPLACE FUNCTION get_unique_ticket_categories()
RETURNS TABLE(category TEXT) AS $$
BEGIN
  RETURN QUERY 
  SELECT DISTINCT t.category 
  FROM tickets as t
  WHERE t.category IS NOT NULL;
END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION send_admin_reply_and_update_status(
  p_ticket_id UUID,
  p_sender_user_id UUID,
  p_message TEXT
)
RETURNS JSON AS $$
DECLARE
  new_message RECORD;
BEGIN
  -- Insert the new chat message
  INSERT INTO chat_messages (ticket_id, sender_user_id, message)
  VALUES (p_ticket_id, p_sender_user_id, p_message)
  RETURNING * INTO new_message;

  -- Check the ticket's current status and update it if it's 'Open'
  UPDATE tickets
  SET status = 'In Progress'
  WHERE id = p_ticket_id AND status = 'Open';

  -- Return the newly created message
  RETURN row_to_json(new_message);
END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION send_admin_reply_and_update_status(
  p_ticket_id UUID,
  p_sender_user_id UUID,
  p_message TEXT
)
RETURNS JSON AS $$
DECLARE
  new_message RECORD;
BEGIN
  -- Insert the new chat message into the 'messages' table
  INSERT INTO messages (ticket_id, sender_user_id, message)
  VALUES (p_ticket_id, p_sender_user_id, p_message)
  RETURNING * INTO new_message;

  -- Check the ticket's current status and update it if it's 'Open'
  UPDATE tickets
  SET status = 'In Progress'
  WHERE id = p_ticket_id AND status = 'Open';

  -- Return the newly created message as JSON
  RETURN row_to_json(new_message);
END;
$$ LANGUAGE plpgsql;  
-- Run this in your Supabase SQL Editor to fix the function signature.

-- The only change is swapping the order of the parameters to match
-- the alphabetical order used by the Supabase client library.
CREATE OR REPLACE FUNCTION update_faculty_availability(
    p_availability JSONB, -- Swapped to be the first parameter
    p_faculty_id UUID     -- Swapped to be the second parameter
)
RETURNS VOID AS $$
BEGIN
    -- This logic remains the same.
    -- Delete existing availability for the faculty
    DELETE FROM public.faculty_availability WHERE faculty_id = p_faculty_id;

    -- Insert new availability if the array is not empty
    IF jsonb_array_length(p_availability) > 0 THEN
        INSERT INTO public.faculty_availability (faculty_id, day_of_week, start_time, end_time)
        SELECT
            p_faculty_id,
            (value->>'day_of_week')::text,
            (value->>'start_time')::time,
            (value->>'end_time')::time
        FROM jsonb_array_elements(p_availability) AS value;
    END IF;
END;
$$ LANGUAGE plpgsql;
-- Certificates Table
CREATE TABLE public.certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    cost NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE public.certificates IS 'Stores information about available certificates and their costs.';

-- Courses Table
CREATE TABLE public.courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    price NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE public.courses IS 'Stores information about available courses and their prices.';

-- Admissions Table
CREATE TABLE public.admissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_name TEXT NOT NULL,
    student_phone_number TEXT NOT NULL,
    father_name TEXT NOT NULL,
    father_phone_number TEXT,
    permanent_address TEXT NOT NULL,
    current_address TEXT,
    address_proof_id_number TEXT NOT NULL,
    certificate_id UUID REFERENCES public.certificates(id),
    total_fees NUMERIC(10, 2) NOT NULL,
    discount NUMERIC(10, 2) DEFAULT 0,
    final_fees NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE public.admissions IS 'Stores detailed information for each student admission.';

-- Admission Courses Junction Table
CREATE TABLE public.admission_courses (
    admission_id UUID NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    PRIMARY KEY (admission_id, course_id)
);
COMMENT ON TABLE public.admission_courses IS 'Maps admissions to the courses selected by the student.';

-- Fee Installments Table
CREATE TABLE public.fee_installments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admission_id UUID NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
    installment_date DATE NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    is_paid BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE public.fee_installments IS 'Stores the payment schedule for each admission.';

-- Follow-ups Table
CREATE TABLE public.follow_ups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admission_id UUID NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
    follow_up_date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE public.follow_ups IS 'Tracks follow-up communications with students regarding fee payments.';

-- Receipts Table
CREATE TABLE public.receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admission_id UUID NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
    receipt_number TEXT NOT NULL UNIQUE,
    amount_paid NUMERIC(10, 2) NOT NULL,
    payment_date DATE NOT NULL,
    generated_by UUID REFERENCES public.users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE public.receipts IS 'Stores information about receipts generated for student payments.';

-- Add indexes for foreign keys to improve query performance
CREATE INDEX idx_admissions_certificate_id ON public.admissions(certificate_id);
CREATE INDEX idx_admission_courses_admission_id ON public.admission_courses(admission_id);
CREATE INDEX idx_admission_courses_course_id ON public.admission_courses(course_id);
CREATE INDEX idx_fee_installments_admission_id ON public.fee_installments(admission_id);
CREATE INDEX idx_follow_ups_admission_id ON public.follow_ups(admission_id);
CREATE INDEX idx_receipts_admission_id ON public.receipts(admission_id);
CREATE INDEX idx_receipts_generated_by ON public.receipts(generated_by);

-- Grant all permissions to the service_role for all new tables
GRANT ALL ON TABLE public.certificates TO service_role;
GRANT ALL ON TABLE public.courses TO service_role;
GRANT ALL ON TABLE public.admissions TO service_role;
GRANT ALL ON TABLE public.admission_courses TO service_role;
GRANT ALL ON TABLE public.fee_installments TO service_role;
GRANT ALL ON TABLE public.follow_ups TO service_role;
GRANT ALL ON TABLE public.receipts TO service_role;

-- =================================================================
-- Clean Slate: Drop existing admission-related tables and functions
-- =================================================================
-- This section safely removes the old tables and their dependencies.
DROP FUNCTION IF EXISTS public.create_admission_and_student(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, NUMERIC, NUMERIC, UUID[]);
DROP TABLE IF EXISTS public.receipts CASCADE;
DROP TABLE IF EXISTS public.follow_ups CASCADE;
DROP TABLE IF EXISTS public.fee_installments CASCADE;
DROP TABLE IF EXISTS public.admission_courses CASCADE;
DROP TABLE IF EXISTS public.admissions CASCADE;
DROP TABLE IF EXISTS public.courses CASCADE;
DROP TABLE IF EXISTS public.certificates CASCADE;
DROP TABLE IF EXISTS public.students CASCADE;


-- =================================================================
-- Recreate Tables with the Correct, Normalized Structure
-- =================================================================

-- Students Table: The single source of truth for student information.
CREATE TABLE public.students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    phone_number TEXT,
    admission_number TEXT UNIQUE,
    father_name TEXT,
    father_phone_number TEXT,
    permanent_address TEXT,
    current_address TEXT,
    address_proof_id_number TEXT,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE public.students IS 'Stores core information about each student.';

-- Certificates Table
CREATE TABLE public.certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    cost NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE public.certificates IS 'Stores information about available certificates and their costs.';

-- Courses Table
CREATE TABLE public.courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    price NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE public.courses IS 'Stores information about available courses and their prices.';

-- Admissions Table: Links a student to their admission-specific details.
CREATE TABLE public.admissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    certificate_id UUID REFERENCES public.certificates(id),
    total_fees NUMERIC(10, 2) NOT NULL,
    discount NUMERIC(10, 2) DEFAULT 0,
    final_fees NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE public.admissions IS 'Stores admission-specific details, linked to a student.';

-- Admission Courses Junction Table
CREATE TABLE public.admission_courses (
    admission_id UUID NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    PRIMARY KEY (admission_id, course_id)
);
COMMENT ON TABLE public.admission_courses IS 'Maps admissions to the courses selected by the student.';

-- Fee Installments Table
CREATE TABLE public.fee_installments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admission_id UUID NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
    installment_date DATE NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    is_paid BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE public.fee_installments IS 'Stores the payment schedule for each admission.';

-- Follow-ups Table
CREATE TABLE public.follow_ups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admission_id UUID NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
    follow_up_date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE public.follow_ups IS 'Tracks follow-up communications with students regarding fee payments.';

-- Receipts Table
CREATE TABLE public.receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admission_id UUID NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
    receipt_number TEXT NOT NULL UNIQUE,
    amount_paid NUMERIC(10, 2) NOT NULL,
    payment_date DATE NOT NULL,
    generated_by UUID REFERENCES public.users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE public.receipts IS 'Stores information about receipts generated for student payments.';


-- =================================================================
-- Create Indexes and Grant Permissions
-- =================================================================

CREATE INDEX idx_admissions_student_id ON public.admissions(student_id);
CREATE INDEX idx_admissions_certificate_id ON public.admissions(certificate_id);
CREATE INDEX idx_admission_courses_admission_id ON public.admission_courses(admission_id);
CREATE INDEX idx_admission_courses_course_id ON public.admission_courses(course_id);
CREATE INDEX idx_fee_installments_admission_id ON public.fee_installments(admission_id);
CREATE INDEX idx_follow_ups_admission_id ON public.follow_ups(admission_id);
CREATE INDEX idx_receipts_admission_id ON public.receipts(admission_id);
CREATE INDEX idx_receipts_generated_by ON public.receipts(generated_by);

GRANT ALL ON TABLE public.students TO service_role;
GRANT ALL ON TABLE public.certificates TO service_role;
GRANT ALL ON TABLE public.courses TO service_role;
GRANT ALL ON TABLE public.admissions TO service_role;
GRANT ALL ON TABLE public.admission_courses TO service_role;
GRANT ALL ON TABLE public.fee_installments TO service_role;
GRANT ALL ON TABLE public.follow_ups TO service_role;
GRANT ALL ON TABLE public.receipts TO service_role;


-- =================================================================
-- The All-in-One Admission Function
-- =================================================================
-- Your application will call this single function to create a new admission.

CREATE OR REPLACE FUNCTION public.create_admission_and_student(
    p_student_name TEXT,
    p_student_phone_number TEXT,
    p_father_name TEXT,
    p_father_phone_number TEXT,
    p_permanent_address TEXT,
    p_current_address TEXT,
    p_address_proof_id_number TEXT,
    p_remarks TEXT,
    p_certificate_id UUID,
    p_total_fees NUMERIC,
    p_discount NUMERIC,
    p_courses UUID[]
)
RETURNS UUID AS $$
DECLARE
  new_student_id UUID;
  new_admission_id UUID;
  v_final_fees NUMERIC;
  course_id UUID;
BEGIN
  -- Calculate final_fees
  v_final_fees := p_total_fees - COALESCE(p_discount, 0);

  -- 1. Insert the new student and get their ID
  INSERT INTO public.students (
      name, phone_number, father_name, father_phone_number, 
      permanent_address, current_address, address_proof_id_number, 
      remarks, admission_number
  )
  VALUES (
    p_student_name, p_student_phone_number, p_father_name, p_father_phone_number,
    p_permanent_address, p_current_address, p_address_proof_id_number,
    p_remarks, gen_random_uuid()::text
  ) RETURNING id INTO new_student_id;

  -- 2. Insert the new admission record, linking it to the new student
  INSERT INTO public.admissions (student_id, certificate_id, total_fees, discount, final_fees)
  VALUES (new_student_id, p_certificate_id, p_total_fees, p_discount, v_final_fees)
  RETURNING id INTO new_admission_id;

  -- 3. Link the selected courses to the admission
  IF p_courses IS NOT NULL THEN
    FOREACH course_id IN ARRAY p_courses
    LOOP
      INSERT INTO public.admission_courses (admission_id, course_id)
      VALUES (new_admission_id, course_id);
    END LOOP;
  END IF;

  -- 4. Return the ID of the newly created admission
  RETURN new_admission_id;
END;
$$ LANGUAGE plpgsql;

-- Grant permission for your application to execute the function
GRANT EXECUTE ON FUNCTION public.create_admission_and_student(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, NUMERIC, NUMERIC, UUID[]) TO service_role;

