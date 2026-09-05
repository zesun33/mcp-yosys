module latch_demo (
    input  wire       en,
    input  wire [3:0] d,
    output reg  [3:0] q
);

// Intentionally incomplete conditional branch to infer transparent latches
always @(*) begin
    if (en) begin
        q = d;
    end
end

endmodule
