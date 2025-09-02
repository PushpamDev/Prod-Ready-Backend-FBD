-- Enable pgcrypto extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Drop existing tables to avoid conflicts
DROP TABLE IF EXISTS public.batch_students;
DROP TABLE IF EXISTS public.faculty_availability;
DROP TABLE IF EXISTS public.faculty_skills;
DROP TABLE IF EXISTS public.batches;
DROP TABLE IF EXISTS public.faculty;
DROP TABLE IF EXISTS public.skills;
DROP TABLE IF EXISTS public.students;


-- Skills Table
-- This table stores the various skills that a faculty member can possess.
CREATE TABLE public.skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    category TEXT,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE public.skills IS 'List of skills that faculty members can have.';

-- Faculty Table
-- This table holds the core information about each faculty member.
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

-- Students Table
CREATE TABLE public.students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    admission_number TEXT NOT NULL UNIQUE,
    phone_number TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE public.students IS 'Information about students.';

-- Batches Table
-- This table is for managing student batches.
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
-- This table links faculty members to their skills, creating a many-to-many relationship.
CREATE TABLE public.faculty_skills (
    faculty_id UUID NOT NULL REFERENCES public.faculty(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
    PRIMARY KEY (faculty_id, skill_id)
);
COMMENT ON TABLE public.faculty_skills IS 'Maps faculty to their skills.';

-- Faculty Availability Table
-- This table is used to track the free slots of faculty members.
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

-- Add indexes for foreign keys to improve query performance
CREATE INDEX idx_faculty_skills_faculty_id ON public.faculty_skills(faculty_id);
CREATE INDEX idx_faculty_skills_skill_id ON public.faculty_skills(skill_id);
CREATE INDEX idx_faculty_availability_faculty_id ON public.faculty_availability(faculty_id);
CREATE INDEX idx_batches_faculty_id ON public.batches(faculty_id);
CREATE INDEX idx_batches_skill_id ON public.batches(skill_id);
CREATE INDEX idx_batch_students_batch_id ON public.batch_students(batch_id);
CREATE INDEX idx_batch_students_student_id ON public.batch_students(student_id);

-- Activities Table
-- This table logs various activities within the system.
CREATE TABLE public.activities (
    id bigserial PRIMARY KEY,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    action character varying,
    item character varying,
    "user" character varying,
    type character varying
);
COMMENT ON TABLE public.activities IS 'Logs activities such as creations, updates, and deletions.'; 