
import React, { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "../hooks/AuthContext";
import { API_BASE_URL } from "@/lib/api";

const AttendanceManagement = () => {
  const { token } = useAuth();
  const { toast } = useToast();
  const [faculties, setFaculties] = useState([]);
  const [batches, setBatches] = useState([]);
  const [selectedFaculty, setSelectedFaculty] = useState(null);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [attendance, setAttendance] = useState([]);

  useEffect(() => {
    const fetchFaculties = async () => {
      if (!token) return;
      try {
        const response = await fetch(`${API_BASE_URL}/api/faculty`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const data = await response.json();
        setFaculties(data);
      } catch (error) {
        console.error("Failed to fetch faculties", error);
      }
    };

    const fetchBatches = async () => {
      if (!token) return;
      try {
        const response = await fetch(`${API_BASE_URL}/api/batches`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const data = await response.json();
        setBatches(data);
      } catch (error) {
        console.error("Failed to fetch batches", error);
      }
    };

    fetchFaculties();
    fetchBatches();
  }, [token]);

  const handleViewAttendance = async () => {
    if (!selectedFaculty || !selectedBatch || !selectedDate) {
      toast({
        title: "Error",
        description: "Please select a faculty, batch, and date.",
        variant: "destructive",
      });
      return;
    }

    try {
      const formattedDate = selectedDate.toISOString().split("T")[0];
      const response = await fetch(
        `${API_BASE_URL}/api/attendance/${selectedFaculty}/${selectedBatch}/${formattedDate}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        setAttendance([]);
        toast({
          title: "Error",
          description: "Failed to fetch attendance.",
          variant: "destructive",
        });
        return;
      }

      const data = await response.json();
      if (Array.isArray(data)) {
        setAttendance(data);
      } else {
        setAttendance([]);
      }
    } catch (error) {
      console.error("Failed to fetch attendance", error);
      setAttendance([]);
      toast({
        title: "Error",
        description: "Failed to fetch attendance.",
        variant: "destructive",
      });
    }
  };
  
  const handleSaveAttendance = async () => {
    if (!selectedBatch || !selectedDate) {
      toast({
        title: "Error",
        description: "Please select a batch and date.",
        variant: "destructive",
      });
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/attendance`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          batchId: selectedBatch,
          date: selectedDate.toISOString().split("T")[0],
          attendance: attendance.map((record) => ({
            student_id: record.student.id,
            is_present: record.is_present,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save attendance");
      }

      toast({
        title: "Success",
        description: "Attendance saved successfully!",
      });
    } catch (error) {
      console.error("Error saving attendance:", error);
      toast({
        title: "Error",
        description: "Failed to save attendance.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Attendance Management</CardTitle>
        <CardDescription>
          View and manage attendance for your batches.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center space-x-4">
          <div className="w-1/3">
            <Select onValueChange={setSelectedFaculty}>
              <SelectTrigger>
                <SelectValue placeholder="Select Faculty" />
              </SelectTrigger>
              <SelectContent>
                {faculties.map((faculty) => (
                  <SelectItem key={faculty.id} value={faculty.id}>
                    {faculty.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-1/3">
            <Select onValueChange={setSelectedBatch}>
              <SelectTrigger>
                <SelectValue placeholder="Select Batch" />
              </SelectTrigger>
              <SelectContent>
                {batches.map((batch) => (
                  <SelectItem key={batch.id} value={batch.id}>
                    {batch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-1/3">
            <DatePicker date={selectedDate} setDate={setSelectedDate} />
          </div>
          <Button onClick={handleViewAttendance}>View Attendance</Button>
          <Button onClick={handleSaveAttendance}>Save Attendance</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {attendance.map((record, index) => (
              <TableRow key={`${record.student.id}-${index}`}>
                <TableCell>{record.student.name}</TableCell>
                <TableCell>
                  <Switch
                    checked={record.is_present}
                    onCheckedChange={(value) => {
                      const newAttendance = [...attendance];
                      newAttendance[index].is_present = value;
                      setAttendance(newAttendance);
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default AttendanceManagement;