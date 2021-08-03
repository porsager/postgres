// Efficient scatter-gather byte-stream queue
// Copyright (C) 2020 Tirotech Ltd
//
// Author: Daniel Beer <daniel.beer@tirotech.co.nz>
//
// Permission to use, copy, modify, and/or distribute this software for any
// purpose with or without fee is hereby granted, provided that the above
// copyright notice and this permission notice appear in all copies.
//
// THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
// WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
// MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
// ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
// WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
// ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
// OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

function fill(out, arr, j) {
    while (out.length > 0 && j < arr.length) {
	let b = arr[j];

	b.copy(out);

	if (b.length <= out.length) {
	    out = out.slice(b.length);
	    j++;
	} else {
	    out = out.slice(out.length);
	}
    }

    return out;
}

function ByteQueue() {
    this.front = [];
    this.back = [];
    this.i = 0;
    this.len = 0;

    return this;
}

ByteQueue.prototype = {
    discard: function(n) {
	while (this.i < this.front.length &&
	       this.front[this.i].length <= n) {
	    n -= this.front[this.i].length;
	    this.len -= this.front[this.i].length;
	    this.i++;
	}

	if (this.i >= this.front.length) {
	    this.front = this.back;
	    this.back = [];
	    this.i = 0;
	}

	while (this.i < this.front.length &&
	       this.front[this.i].length <= n) {
	    n -= this.front[this.i].length;
	    this.len -= this.front[this.i].length;
	    this.i++;
	}

	if (n > 0) {
	    if (this.i >= this.front.length ||
		this.front[this.i].length < n)
		throw "ByteQueue underrun";

	    this.front[this.i] = this.front[this.i].slice(n);
	    this.len -= n;
	}
    },

    size: function() {
	return this.len;
    },

    push: function(x) {
	this.back.push(x);
	this.len += x.length;
    },

    peekTo: function(buf) {
	buf = fill(buf, this.front, this.i);
	buf = fill(buf, this.back, 0);

	if (buf.length > 0)
	    throw "ByteQueue underrun";
    },

    peek: function(n) {
	const buf = Buffer.alloc(n);
	this.peekTo(buf);
	return buf;
    },

    shiftTo: function(buf) {
	this.peekTo(buf);
	this.discard(buf.length);
    },

    shift: function(n) {
	const buf = this.peek(n)
	this.discard(n)
	return buf
    }
}

module.exports = { ByteQueue };
