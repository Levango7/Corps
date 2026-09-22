-- Add indexes for meeting queries performance
-- MeetingParticipant: optimize online participant queries (WHERE meetingId = ? AND leftAt IS NULL)
CREATE INDEX "meeting_participants_meeting_id_left_at_idx" ON "public"."meeting_participants"("meeting_id", "left_at");

-- Meeting: optimize user-created meetings list queries (WHERE createdBy = ?)
CREATE INDEX "meetings_created_by_idx" ON "public"."meetings"("created_by");