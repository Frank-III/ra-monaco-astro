import { db, CodeSnippet } from "astro:db";
import type { APIRoute } from "astro";

export const POST: APIRoute = async ({ params, request }) => {
  try {
    const { code } = await request.json();
    const id = Math.random().toString(36).substring(2, 15);
    // console.log("id: ", id);
    // console.log("code: ", code);
    const result = await db
      .insert(CodeSnippet)
      .values({
        id,
        code,
      })
      .returning();

    return new Response(JSON.stringify({ success: true, data: result[0] }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}