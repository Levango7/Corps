import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    code: 200,
    data: { message: "corps API is running" },
  });
}
