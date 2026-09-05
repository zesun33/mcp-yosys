module adder (
    input  wire [3:0] a,
    input  wire [3:0] b,
    output wire [3:0] sum
);
    assign sum = a + b;
endmodule

module sub (
    input  wire [3:0] a,
    input  wire [3:0] b,
    output wire [3:0] diff
);
    assign diff = a - b;
endmodule

module alu_top (
    input  wire       sel,
    input  wire [3:0] a,
    input  wire [3:0] b,
    output wire [3:0] y
);
    wire [3:0] sum_out;
    wire [3:0] diff_out;

    adder u_add (
        .a(a),
        .b(b),
        .sum(sum_out)
    );

    sub u_sub (
        .a(a),
        .b(b),
        .diff(diff_out)
    );

    assign y = sel ? diff_out : sum_out;
endmodule
