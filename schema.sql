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
